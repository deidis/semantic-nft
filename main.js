import path from 'path'
import {prepareMetadata, clean, artworkPaths, ingest} from './src/metadata.js'
import {prepareArtworks} from './src/artwork.js'
import {collectFiles} from './src/collectFiles.js'
import {prepareCertificates} from './src/certificate.js'
import {exiftool} from 'exiftool-vendored'

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
const workingFiles = prepareArtworks(originalArtworkPaths, metadata)

console.log('Cleaning metadata...')
clean(Object.values(workingFiles))
    .then(async () => {
      console.log('Ingesting metadata...')
      await ingest()

      console.log('Prepare certificates of authenticity...')
      await prepareCertificates(metadata)
    }).catch((err) => {
      console.error(err)
    }).finally(() => {
      exiftool.end(true).finally(() => {
        console.log('Done.')
      })
    })
