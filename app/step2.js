import path from 'path'
import {prepareMetadata, clean, artworkPaths, ingest} from '../src/metadata.js'
import {prepareArtworks, tokenize} from '../src/artwork.js'
import {collectFiles} from '../src/collectFiles.js'
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

  console.log('Preparing working files (without overwriting)...')
  await prepareArtworks(originalArtworkPaths, metadata, false)

  /*
   * NOTE: certificates are irrelevant in this step, as we don't need to overwrite them.
   * They might be added only after executing the step1, because signing them is a "slow" procedure.
   */

  console.log('Ingesting metadata (overwriting)...')
  await clean(artworkPaths())
  await ingest()

  // TODO: move the above code into a reusable service.
  // TODO: create a step12.js, then step3.js (for uploading to IPFS), then step123.js (for everything)

  // TODO: (phase 2) make this a CLI tool
  // TODO: (phase 2) make this a nodjs module, which works with the CLI tool

  // TODO: (phase 2)make sure everything works on Windows, because we use a lot of file path manipulation
  // TODO: (phase 2) improve debugging and logging

  console.log('Preparing NFTs...')
  await tokenize(metadata)
  // console.log(JSON.stringify(metadata, null, 2))
} catch (err) {
  // console.error('ERROR:', err.message)
  console.error(err)
} finally {
  exiftool.end(true).finally(() => {
    console.log('Done.')
  })
}
