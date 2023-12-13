import path from 'path'
import {prepareMetadata, clean, artworkPaths, ingest} from '../src/metadata.js'
import {prepareArtworks} from '../src/artwork.js'
import {collectFiles} from '../src/collectFiles.js'
import {prepareCertificates} from '../src/certificate.js'
import {exiftool} from 'exiftool-vendored'

try {
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
  const workingFiles = await prepareArtworks(originalArtworkPaths, metadata)

  console.log('Cleaning metadata...')
  await clean(Object.values(workingFiles))

  console.log('Ingesting metadata...')
  await ingest()

  console.log('Prepare certificates of authenticity...')
  await prepareCertificates(metadata)
  // console.log(JSON.stringify(metadata, null, 2))
} catch (err) {
  console.error(err)
} finally {
  exiftool.end(true).finally(() => {
    console.log('Done.')
  })
}
