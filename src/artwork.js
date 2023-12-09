import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import {artworkPreviewFileExtension} from './metadata.js'

export const ARTWORK_FILE_NAME_WITHOUT_EXT = 'artwork'
export const ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT = 'preview'

/**
 * Prepare every artwork for NFT processing
 * @param {string[]} originalArtworkAbsolutePaths - Absolute paths to original artwork files
 * @param {object | undefined | null} metadata - Metadata from the TOML file, if needs fixing
 * @return {{string: string}} - Map of original artwork file to working file
 */
export function prepare(originalArtworkAbsolutePaths, metadata) {
  const result = {}
  originalArtworkAbsolutePaths.forEach(async (artworkFile) => {
    const dir = path.dirname(artworkFile)
    const ext = path.extname(artworkFile)
    const basename = path.basename(artworkFile, ext)
    const newDir = path.join(dir, basename)
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir)
    }
    const newFile = path.join(newDir, /* path.basename(file) */ `${ARTWORK_FILE_NAME_WITHOUT_EXT}${ext}`)
    fs.copyFileSync(artworkFile, newFile)

    // Point to working file
    result[artworkFile] = newFile

    // Fix metadata
    if (metadata) {
      // Update the metadata to point to the working file
      metadata[`file://${newFile}`] = metadata[`file://${artworkFile}`]
      delete metadata[`file://${artworkFile}`]

      const previewFile = await _createPreview(newFile, artworkPreviewFileExtension(artworkFile, metadata))

      const artworkTitle = metadata[`file://${newFile}`]['XMP-dc:Title'] ||
          metadata[`file://${newFile}`]['Exif:ImageDescription']

      // Update the title on the preview image, so that it's clear that it's not the real artwork
      const previewImageTitle = {}

      // As we're updating the title here, do it in the normalized way
      if (artworkTitle && artworkTitle.length > 0) {
        previewImageTitle['XMP-dc:Title'] =
          previewImageTitle['Exif:ImageDescription'] = 'Preview of: ' + artworkTitle
      } else {
        previewImageTitle['XMP-dc:Title'] =
          previewImageTitle['Exif:ImageDescription'] = 'Preview'
      }

      metadata[`file://${previewFile}`] = {
        ...metadata[`file://${artworkFile}`],
        ...previewImageTitle,
        ...metadata[`file://${previewFile}`] // Keep any prescribed metadata
      }
    } else {
      await _createPreview(newFile)
    }
  })

  return result
}

/**
 * Create view image
 * @param {string} readyArtworkAbsolutePath
 * @param {string | undefined | null} extensionHint
 * @return {Promise<string>} - Absolute path to preview image
 */
async function _createPreview(readyArtworkAbsolutePath, extensionHint = null) {
  const dir = path.dirname(readyArtworkAbsolutePath)
  let ext = path.extname(readyArtworkAbsolutePath)
  if (ext === '.webp') {
    // Prefer PNG over WebP because some marketplaces (e.g. foundation.app) don't support WebP.
    ext = '.png'
  }

  if (extensionHint) {
    if (!extensionHint.startsWith('.')) {
      extensionHint = '.' + extensionHint
    }
    ext = extensionHint
  }

  /** @type {string} */
  const previewFilePath = path.join(dir, `${ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT}${ext}`)
  // ERC-721 suggestion:
  // Consider making any images at a width between 320 and 1080 pixels and
  // aspect ratio between 1.91:1 and 4:5 inclusive.
  return sharp(readyArtworkAbsolutePath)
      .resize(1080, 1080, {withoutEnlargement: true, fit: 'inside'})
      .toFile(previewFilePath)
      .then(async () => {
        return previewFilePath
      })
}
