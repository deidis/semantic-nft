import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import {artworkPreviewFileExtension, artworkURIs} from './metadata.js'
import SemanticNFT from './SemanticNFT.js'
import {lookupQualifiedName, updateObjectFieldWithAllSynonyms} from './vocabulary.js'
import _ from 'lodash'

export const ARTWORK_FILE_NAME_WITHOUT_EXT = 'artwork'
export const ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT = 'preview'

/**
 * Prepare every artwork for NFT processing
 * @param {string[]} originalArtworkAbsolutePaths - Absolute paths to original artwork files
 * @param {object | undefined | null} preparedMetadata - Metadata from the TOML file, if needs fixing
 * @param {boolean} overwrite - Whether to overwrite existing files
 * @return {Promise<void>}
 */
export async function prepareArtworks(originalArtworkAbsolutePaths, preparedMetadata, overwrite = true) {
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

    const artworkURI = `file://${workingArtworkAbsolutePath}`

    // Fix metadata
    if (preparedMetadata) {
      // Update the metadata to point to the working file
      preparedMetadata[artworkURI] = preparedMetadata[`file://${originalArtworkAbsolutePath}`]
      delete preparedMetadata[`file://${originalArtworkAbsolutePath}`]
    }
  })

  // Preview specific metadata
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
      let previewImageTitleStr = 'Preview'
      if (artworkTitle && artworkTitle.length > 0) {
        previewImageTitleStr = 'Preview of: ' + artworkTitle
      }
      const previewImageTitle = {}
      updateObjectFieldWithAllSynonyms(
          previewImageTitle,
          'XMP-dc:Title', previewImageTitleStr
      )

      preparedMetadata[`file://${absolutePreviewWorkingPath}`] =
          preparedMetadata[`file://${absolutePreviewWorkingPath}`] || {}

      Object.keys(preparedMetadata[`file://${absolutePreviewWorkingPath}`]).forEach((key) => {
        const metadata = preparedMetadata[`file://${absolutePreviewWorkingPath}`]
        const thisKey = lookupQualifiedName(key, metadata[key], false)
        if (thisKey !== key) {
          metadata[thisKey] = _.isString(metadata[key]) ? metadata[key].trim() : metadata[key]
          delete metadata[key]
          key = thisKey
        } else {
          metadata[key] = _.isString(metadata[key]) ? metadata[key].trim() : metadata[key]
        }

        updateObjectFieldWithAllSynonyms(metadata, key, metadata[key], false)
      })

      // Keep any prescribed metadata specifically for the preview image
      preparedMetadata[`file://${absolutePreviewWorkingPath}`] = {
        ...previewImageTitle,
        ...preparedMetadata[`file://${absolutePreviewWorkingPath}`]
      }

      // We don't need all the metadata from the artwork on the preview, so we can clean it up
      Object.keys(preparedMetadata[`file://${absolutePreviewWorkingPath}`]).forEach((key) => {
        if (key.startsWith('schema:') || key.startsWith('nft:')) {
          delete preparedMetadata[`file://${absolutePreviewWorkingPath}`][key]
        }
      })

      if (!preparedMetadata[artworkURI]['nft:image']) {
        updateObjectFieldWithAllSynonyms(
            preparedMetadata[artworkURI],
            'nft:image',
            `file://${absolutePreviewWorkingPath}`,
            false)
      }
    })
    )
  })

  return Promise.all(previewPromises).then(() => {
    _copyLicensesToWorkingDir(preparedMetadata, overwrite)
    _copyOtherAssociatedMediaToWorkingDir(preparedMetadata, overwrite)
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
 * @throws {Error} - If license is not defined
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
      updateObjectFieldWithAllSynonyms(
          metadata[artworkURI],
          'XMP-xmpRights:WebStatement',
          `file://${licenseWorkingFilePath}`
      )
    } else {
      if (!licenseUri) {
        throw Error(`License is not defined for ${artworkURI}`)
      }
    }
  })
}

/**
 * Copy all files that were provided in schema:associatedMedia to the working directory
 * @param {object} metadata
 * @param {boolean} overwrite
 * @private
 */
function _copyOtherAssociatedMediaToWorkingDir(metadata, overwrite = true) {
// TODO: (phase 2) collect all files that were prescribed in schema:associatedMedia and adjust the metadata accordingly
}


/**
 * @param {object} metadata
 */
export async function tokenize(metadata) {
  for (const artworkUri of artworkURIs(metadata)) {
    const previewExt = artworkPreviewFileExtension(artworkUri, metadata)
    const artworkPreviewUri = path.dirname(artworkUri) +
        path.sep +
        ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT +
        previewExt
    await (new SemanticNFT(artworkUri, metadata[artworkUri], artworkPreviewUri)).build()
  }
}
