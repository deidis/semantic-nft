import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import {artworkPaths, artworkPreviewFileExtension, artworkURIs} from './metadata.js'

export const ARTWORK_FILE_NAME_WITHOUT_EXT = 'artwork'
export const ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT = 'preview'

/**
 * Prepare every artwork for NFT processing
 * @param {string[]} originalArtworkAbsolutePaths - Absolute paths to original artwork files
 * @param {object | undefined | null} preparedMetadata - Metadata from the TOML file, if needs fixing
 * @param {boolean} overwrite - Whether to overwrite existing files
 * @return {Promise<{string: string}>} - Map of original artwork file to working file
 */
export async function prepareArtworks(originalArtworkAbsolutePaths, preparedMetadata, overwrite = true) {
  const result = {}
  originalArtworkAbsolutePaths.forEach((originalArtworkAbsolutePath) => {
    const dir = path.dirname(originalArtworkAbsolutePath)
    const ext = path.extname(originalArtworkAbsolutePath)
    const basename = path.basename(originalArtworkAbsolutePath, ext)
    const newDir = path.join(dir, basename)
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir)
    }

    // Copy the artwork to the working directory
    const workingArtworkAbsolutePath = path.join(newDir, `${ARTWORK_FILE_NAME_WITHOUT_EXT}${ext}`)
    if (fs.existsSync(workingArtworkAbsolutePath)) {
      if (overwrite) {
        fs.copyFileSync(originalArtworkAbsolutePath, workingArtworkAbsolutePath)
      }
    } else {
      fs.copyFileSync(originalArtworkAbsolutePath, workingArtworkAbsolutePath)
    }

    // Point to working file
    result[originalArtworkAbsolutePath] = workingArtworkAbsolutePath

    const artworkURI = `file://${workingArtworkAbsolutePath}`

    // Fix metadata
    if (preparedMetadata) {
      // Update the metadata to point to the working file
      preparedMetadata[artworkURI] = preparedMetadata[`file://${originalArtworkAbsolutePath}`]
      delete preparedMetadata[`file://${originalArtworkAbsolutePath}`]
    }
  })

  const previewPromises = []
  artworkURIs(preparedMetadata).forEach((artworkURI) => {
    const workingArtworkAbsolutePath = artworkURI.replace('file://', '')
    previewPromises.push(_createPreview(
        workingArtworkAbsolutePath,
        artworkPreviewFileExtension(workingArtworkAbsolutePath, preparedMetadata),
        overwrite
    ).then((absolutePreviewWorkingPath) => {
      const artworkTitle = preparedMetadata[artworkURI]['XMP-dc:Title'] ||
              preparedMetadata[artworkURI]['Exif:ImageDescription']

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

      preparedMetadata[`file://${absolutePreviewWorkingPath}`] = {
        ...preparedMetadata[artworkURI],
        ...previewImageTitle,
        ...preparedMetadata[`file://${absolutePreviewWorkingPath}`] // Keep any prescribed metadata
      }
    })
    )
  })

  return Promise.all(previewPromises).then(() => {
    _copyLicensesToWorkingDir(preparedMetadata, overwrite)
    return result
  })
}

/**
 * Create view image
 * @param {string} readyArtworkAbsolutePath
 * @param {string | undefined | null} extensionHint
 * @param {boolean} overwrite
 * @return {Promise<string>} - Absolute path to preview image
 */
async function _createPreview(readyArtworkAbsolutePath, extensionHint = null, overwrite = true) {
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
  if (fs.existsSync(previewFilePath)) {
    if (!overwrite) {
      return Promise.resolve(previewFilePath)
    }
  }

  // ERC-721 suggestion:
  // Consider making any images at a width between 320 and 1080 pixels and
  // aspect ratio between 1.91:1 and 4:5 inclusive.
  return sharp(readyArtworkAbsolutePath)
      .resize(1080, 1080, {withoutEnlargement: true, fit: 'inside'})
      .toFile(previewFilePath)
      .then(() => {
        return previewFilePath
      })
}

/**
 * @param {object} metadata
 * @param {boolean} overwrite
 * @private
 */
function _copyLicensesToWorkingDir(metadata, overwrite = true) {
  artworkURIs(metadata).forEach((artworkURI) => {
    const licenseUri = metadata[artworkURI]['XMP-xmpRights:WebStatement']
    if (licenseUri && licenseUri.startsWith('file://')) {
      const licenseAbsolutePath = licenseUri.replace('file://', '')
      const licenseWorkingFilePath = `${path.dirname(artworkURI.replace('file://', ''))}/${path.basename(licenseUri)}`
      if (fs.existsSync(licenseWorkingFilePath)) {
        if (overwrite) {
          fs.copyFileSync(
              licenseAbsolutePath,
              licenseWorkingFilePath
          )
        }
      } else {
        fs.copyFileSync(
            licenseAbsolutePath,
            licenseWorkingFilePath
        )
      }

      // Update the metadata to point to the working file
      metadata[artworkURI]['XMP-xmpRights:WebStatement'] = `file://${licenseWorkingFilePath}`
    } else {
      if (!licenseUri) {
        throw Error(`License is not defined for ${artworkURI}`)
      }
    }
  })
}

/**
 * Create UDA.zip or EDA.png along with nft.json
 *
 * @param {string[]} workingArtworkAbsolutePaths
 * @param {object} metadata
 */
export function tokenize(workingArtworkAbsolutePaths, metadata) {
  workingArtworkAbsolutePaths.forEach((workingArtworkAbsolutePath) => {
    _validateCorrectnessAndGenerateInfoPage(metadata)
    // TODO: generate token nft.json
    // TODO: generate UDA.zip or EDA.png
  })
}

/**
 * @param {object} metadata
 * @private
 */
function _validateCorrectnessAndGenerateInfoPage(metadata) {
  if (metadata) {
    // TODO: validate metadata and generate info page
  }
}
