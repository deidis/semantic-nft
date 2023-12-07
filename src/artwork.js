import fs from 'fs'
import path from 'path'

/**
 * Prepare every artwork for NFT processing
 * @param {string[]} originalArtworkAbsolutePaths - Absolute paths to original artwork files
 * @param {object | undefined | null} metadata - Metadata from the TOML file, if needs fixing
 * @return {{string: string}} - Map of original artwork file to working file
 */
export function prepare(originalArtworkAbsolutePaths, metadata) {
  const result = {}
  originalArtworkAbsolutePaths.forEach((artworkFile) => {
    const dir = path.dirname(artworkFile)
    const ext = path.extname(artworkFile)
    const basename = path.basename(artworkFile, ext)
    const newDir = path.join(dir, basename)
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir)
    }
    const newFile = path.join(newDir, /* path.basename(file) */ 'artwork' + ext)
    fs.copyFileSync(artworkFile, newFile)

    // Point to working file
    result[artworkFile] = newFile

    // Fix metadata
    if (metadata) {
      metadata[`file://${newFile}`] = metadata[`file://${artworkFile}`]
      delete metadata[`file://${artworkFile}`]
    }
  })

  return result
}
