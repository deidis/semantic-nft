const {collect} = require('./src/collect')
const {clean} = require('./src/clean')
const path = require('path')
const fs = require('fs')
const {ingest, prepareMetadata} = require('./src/ingest')

const args = process.argv.slice(2)
if (args.length === 0) {
  console.log('Please provide the path(s) to metadata TOML file(s).')
  process.exit(1)
}

// Collect files from the arguments
const tomlFileAbsolutePaths = args.flatMap((arg) => {
  return collect(path.resolve(arg), 0, ['toml'])
})
console.debug(`Found ${tomlFileAbsolutePaths.length} files.`)
tomlFileAbsolutePaths.forEach((file) => {
  console.debug(`- ${path.relative(process.cwd(), file)}`)
})


const metadata = prepareMetadata(tomlFileAbsolutePaths)

// Collect files from metadata
const originalArtworkPaths = Object.keys(metadata).filter((key) => {
  return key.startsWith('file:///')
}).map((key) => {
  return key.replace('file://', '')
})
console.debug(`Found ${originalArtworkPaths.length} artworks.`)
originalArtworkPaths.forEach((file) => {
  console.debug(`- ${path.relative(process.cwd(), file)}`)
})

console.log('Preparing working artwork files...')

// Prepare every artwork for NFT processing
const nftArtworkPaths = originalArtworkPaths.map((artworkFile) => {
  const dir = path.dirname(artworkFile)
  const ext = path.extname(artworkFile)
  const basename = path.basename(artworkFile, ext)
  const newDir = path.join(dir, basename)
  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir)
  }
  const newFile = path.join(newDir, /* path.basename(file) */ 'artwork' + ext)
  fs.copyFileSync(artworkFile, newFile)

  // Fix metadata
  metadata[`file://${newFile}`] = metadata[`file://${artworkFile}`]
  delete metadata[`file://${artworkFile}`]

  // Point to working file
  return newFile
})

const exiftool = require('exiftool-vendored').exiftool

console.log('Cleaning metadata...')
clean(exiftool, nftArtworkPaths)
    .then(() => {
      console.log('Ingesting metadata...')
      return ingest(exiftool)
    }).catch((err) => {
      console.error(err)
    }).finally(() => {
      exiftool.end(true).finally(() => {
        console.log('Done.')
      })
    })
