const {collectFiles} = require('./src/collectFiles')
const path = require('path')
const {ingest, prepareMetadata, clean, artworkPaths} = require('./src/metadata')
const {prepare} = require('./src/artwork')

const args = process.argv.slice(2)
if (args.length === 0) {
  console.log('Please provide the path(s) to metadata TOML file(s).')
  process.exit(1)
}

// Collect files from the arguments
const tomlFileAbsolutePaths = args.flatMap((arg) => {
  return collectFiles(path.resolve(arg), 0, ['toml'])
})
console.debug(`Found ${tomlFileAbsolutePaths.length} files.`)
tomlFileAbsolutePaths.forEach((file) => {
  console.debug(`- ${path.relative(process.cwd(), file)}`)
})

const metadata = prepareMetadata(tomlFileAbsolutePaths)

// Collect files from metadata
const originalArtworkPaths = artworkPaths(metadata)
console.debug(`Found ${originalArtworkPaths.length} artworks.`)
originalArtworkPaths.forEach((file) => {
  console.debug(`- ${path.relative(process.cwd(), file)}`)
})

console.log('Preparing working artwork files...')
const workingFiles = prepare(originalArtworkPaths, metadata)

const exiftool = require('exiftool-vendored').exiftool

console.log('Cleaning metadata...')
clean(exiftool, Object.values(workingFiles))
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
