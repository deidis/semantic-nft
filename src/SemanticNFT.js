import _ from 'lodash'
import path from 'path'
import {createHash} from 'node:crypto'
import fs from 'fs'
import web3 from 'web3'
import mime from 'mime'
import sharp from 'sharp'
import {calculateCID} from './ipfs.js'

/**
 * @class SemanticNFT
 */
export default class SemanticNFT {
  /**
   * @type {object}
   */
  #artworkMetadata
  /**
   * @type {string}
   */
  #artworkUri
  /**
   * @type {string}
   */
  #artworkPreviewUri
  /**
   * @type {string}
   */
  #artworkMimeType

  /**
   * @constructor
   * @param {string} artworkWorkingFileUri - The URI of the artwork (normalized TOML header)
   * @param {object} artworkRelatedMetadata - The metadata from the TOML, ready to be used
   * @param {string|null} previewWorkingFileUri - The URI of the preview
   * @param {boolean} validate - If true, will do the validation regarding signed certificate, etc.
   * @private
   */
  constructor(
      artworkWorkingFileUri,
      artworkRelatedMetadata,
      previewWorkingFileUri = null) {
    this.#artworkMetadata = artworkRelatedMetadata
    this.#artworkUri = artworkWorkingFileUri
    this.#artworkPreviewUri = previewWorkingFileUri
    this.#artworkMimeType = mime.getType(this.#artworkUri)
  }

  build = async () => {
    // TODO: make it true after development, or configurable
    const validate = false

    await this._collectAssociatedMedia()

    // Only this one is currently supported
    this.#artworkMetadata['schema:@context'] = 'https://schema.org/'

    if (!this.#artworkMetadata['schema:@type']) {
      this.#artworkMetadata['schema:@type'] = 'CreativeWork'
    }

    if (validate) {
      this._validate()
    }

    await this._generateInfoDoc()

    await this._package()

    let tokenJsonObj = _.mapKeys(
        _.reduce(this.#artworkMetadata, function(result, value, key) {
          if (key.startsWith('nft:') || key.startsWith('schema:') ) {
            result[key] = value
          }
          return result
        }, {}),
        (value, key) => {
          return key.replace('nft:', '').replace('schema:', '')
        })

    tokenJsonObj = await this._mapToIpfs(tokenJsonObj, false)

    // console.log(tokenJsonObj)

    fs.writeSync(
        fs.openSync(path.join(path.dirname(this.#artworkUri.replace('file://', '')), 'nft.json'), 'w'),
        JSON.stringify(tokenJsonObj, null, 2)
    )

    // TODO: transform the json so that the url as well as contentUrl file:// points to ipfs://
  }


  _generateInfoDoc = async () => {
    // TODO: implement generation of the informational doc. Add it to nft.json as associated media
  }

  /**
   *
   * @param {object} metadata
   * @param {boolean} alsoUpload
   * @return {Promise<object>} an object where all the file:// entries are replaced with calculated CID (hence ipfs://...)
   * @private
   */
  _mapToIpfs = async (metadata, alsoUpload = false) => {
    // TODO: (phase 2) uplaod to IPFS and get the token ID this way
    if (alsoUpload || !alsoUpload) {
      return await _mapObjectRecursivelyAsync(metadata, async (value) => {
        if (_.isString(value) && value.startsWith('file://')) {
          return await calculateCID(value.replace('file://', '')).then((cid) => {
            return `ipfs://${cid}`
          })
        }
        return value
      })
    }
  }

  _package = async () => {
    // TODO: zip associatedMedia, and adjust the metadata
  }

  /**
   * @method _collectAssociatedMedia
   * @private
   */
  async _collectAssociatedMedia() {
    // TODO: (phase 2) we don't want to set the contentUrl if we do the unlockable content
    const artworkPubliclyAvailable = true

    const artworkFileBuffer = fs.readFileSync(this.#artworkUri.replace('file://', ''))
    const artworkMedia = {
      '@type': this.#artworkMimeType.startsWith('image') ? 'ImageObject' :
        (this.#artworkMimeType.startsWith('text') ? 'TextObject' :
            (this.#artworkMimeType.startsWith('video') ? 'VideoObject' :
                (this.#artworkMimeType.startsWith('audio') ? 'AudioObject' : 'MediaObject'))),
      'identifier': path.basename(this.#artworkUri),
      'name': _.capitalize(path.basename(this.#artworkUri, path.extname(this.#artworkUri))),
      'encodingFormat': this.#artworkMimeType,
      'additionalProperty': {
        '@type': 'PropertyValue',
        'name': 'sha256',
        'value': createHash('sha256').update(artworkFileBuffer).digest('hex')
      }
    }

    if (this.#artworkMimeType.startsWith('image')) {
      const artworkMediaMetadata = await sharp(artworkFileBuffer).metadata()
      artworkMedia['contentSize'] = `${artworkMediaMetadata['size']}`
      artworkMedia['width'] = `${artworkMediaMetadata['width']}`
      artworkMedia['height'] = `${artworkMediaMetadata['height']}`

      artworkMedia['description'] = [
        `${artworkMediaMetadata.width} x ${artworkMediaMetadata.height}`,
        artworkMediaMetadata.width > artworkMediaMetadata.height ? 'landscape' : (
            artworkMediaMetadata.width < artworkMediaMetadata.height ? 'portrait' : 'square'),
        artworkMediaMetadata.density ?
            `${artworkMediaMetadata.density} pixels per ${artworkMediaMetadata.resolutionUnit}` : ''
      ].filter((section) => !!section).join(', ')
    }

    if (artworkPubliclyAvailable) {
      artworkMedia['contentUrl'] = this.#artworkUri
    }

    if (this.#artworkPreviewUri) {
      artworkMedia['thumbnailUrl'] = this.#artworkPreviewUri

      const artworkPreviewFileBuffer = fs.readFileSync(this.#artworkPreviewUri.replace('file://', ''))
      const artworkPreviewMedia = {
        '@type': 'ImageObject',
        'identifier': path.basename(this.#artworkPreviewUri),
        'name': _.capitalize(path.basename(this.#artworkPreviewUri, path.extname(this.#artworkPreviewUri))),
        'contentUrl': this.#artworkPreviewUri,
        'encodingFormat': mime.getType(this.#artworkPreviewUri),
        'additionalProperty': {
          '@type': 'PropertyValue',
          'name': 'sha256',
          'value': createHash('sha256').update(artworkPreviewFileBuffer).digest('hex')
        }
      }

      const artworkPreviewMediaMetadata = await sharp(artworkPreviewFileBuffer).metadata()
      artworkPreviewMedia['contentSize'] = `${artworkPreviewMediaMetadata['size']}`
      artworkPreviewMedia['width'] = `${artworkPreviewMediaMetadata['width']}`
      artworkPreviewMedia['height'] = `${artworkPreviewMediaMetadata['height']}`

      artworkPreviewMedia['description'] = [
        `${artworkPreviewMediaMetadata.width} x ${artworkPreviewMediaMetadata.height}`,
        artworkPreviewMediaMetadata.width > artworkPreviewMediaMetadata.height ? 'landscape' : (
            artworkPreviewMediaMetadata.width < artworkPreviewMediaMetadata.height ? 'portrait' : 'square'),
        artworkPreviewMediaMetadata.density ?
            `${artworkPreviewMediaMetadata.density} pixels per ${artworkPreviewMediaMetadata.resolutionUnit}` : ''
      ].filter((section) => !!section).join(', ')

      this._enrichSchemaAssociatedMedia(this.#artworkMetadata, artworkPreviewMedia)
    }

    this._enrichSchemaAssociatedMedia(this.#artworkMetadata, artworkMedia)


    const licenseUri = this.#artworkMetadata['schema:license']
    if (licenseUri) {
      this._enrichSchemaAssociatedMedia(this.#artworkMetadata, {
        '@type': mime.getType(licenseUri).startsWith('text') ? 'TextObject' : 'MediaObject',
        'identifier': path.basename(licenseUri),
        'name': 'License',
        'contentUrl': licenseUri,
        'encodingFormat': mime.getType(licenseUri),
        'contentSize': fs.statSync(licenseUri.replace('file://', '')).size,
        'additionalProperty': {
          '@type': 'PropertyValue',
          'name': 'sha256',
          'value': createHash('sha256')
              .update(fs.readFileSync(licenseUri.replace('file://', ''))).digest('hex')
        }
      })
    }

    const certificateUri = Object.keys(this.#artworkMetadata['XMP-xmpRights:Certificate'])[0]
    if (certificateUri) {
      this._enrichSchemaAssociatedMedia(this.#artworkMetadata, {
        '@type': 'MediaObject', // Maybe use LegislationObject?
        'identifier': path.basename(certificateUri),
        'name': 'Certificate of Authenticity',
        'contentUrl': certificateUri,
        'encodingFormat': mime.getType(certificateUri),
        'contentSize': fs.statSync(certificateUri.replace('file://', '')).size,
        'additionalProperty': {
          '@type': 'PropertyValue',
          'name': 'sha256',
          'value': createHash('sha256')
              .update(fs.readFileSync(certificateUri.replace('file://', ''))).digest('hex')
        },
      })
    }
  }

  /**
   * @method _enrichSchemaAssociatedMedia
   * @param {object} artworkMetadata
   * @param {object} associatedMediaObjectMetadata
   * @private
   */
  _enrichSchemaAssociatedMedia(artworkMetadata, associatedMediaObjectMetadata) {
    artworkMetadata['schema:associatedMedia'] =
        artworkMetadata['schema:associatedMedia'] === undefined ? [] : artworkMetadata['schema:associatedMedia']

    if (_isObject(artworkMetadata['schema:associatedMedia'])) {
      artworkMetadata['schema:associatedMedia'] = Object.values(artworkMetadata['schema:associatedMedia'])
    }

    let foundAt = -1
    artworkMetadata['schema:associatedMedia'].forEach((obj, index) => {
      if (obj['identifier'] === associatedMediaObjectMetadata['identifier']) {
        foundAt = index
      }
    })
    if (foundAt !== -1) {
      _.merge(artworkMetadata['schema:associatedMedia'][foundAt], associatedMediaObjectMetadata)
    } else {
      artworkMetadata['schema:associatedMedia'].push(associatedMediaObjectMetadata)
    }
  }

  /**
   * @method _validate
   */
  _validate() {
    // Validate the identifier
    // We expect: urn:<blockchain>:<collectionid>:<tokenid>
    const id = this.#artworkMetadata['XMP-dc:identifier'] || ''
    const idSplits = id.split(':')
    if (idSplits.length !== 4) {
      throw Error(`Invalid identifier: ${id}`)
    }
    idSplits.forEach((part, index) => {
      if (part.length === 0) {
        throw Error(`Invalid identifier: ${id}`)
      }
      switch (index) {
        case 0:
          if (part !== 'urn') {
            throw Error(`Invalid identifier: ${id}`)
          }
          break
        case 1:
          if (part !== 'ethereum') {
            throw Error(`Invalid identifier: ${id}`)
          }
          break
        case 2:
          if (web3.utils.isAddress(part)) {
            throw Error(`Invalid identifier: ${id}`)
          }
          break
        case 3:
          if (isNaN(part)) {
            throw Error(`Invalid identifier: ${id}`)
          }
          break
      }
    })

    if (!this.#artworkMetadata['schema:@type'] ||
        !['CreativeWork', 'Photograph'].includes(this.#artworkMetadata['schema:@type'])) {
      throw Error('Missing schema:@type is invalid. Must be CreativeWork or Photograph')
    }

    // TODO: (phase 2) validate schema:@type. We must only allow CreativeWork or its sub types
  }
}

/**
 * Check if the variable is an object
 * @param {*} variable
 * @return {boolean}
 * @private
 */
function _isObject(variable) {
  return typeof variable === 'object' && variable !== null && !Array.isArray(variable)
}

/**
 * @param {object} obj
 * @param {function} asyncCallback
 * @return {object}
 * @private
 */
async function _mapObjectRecursivelyAsync(obj, asyncCallback) {
  const newObj = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'object') {
        newObj[key] = await _mapObjectRecursivelyAsync(obj[key], asyncCallback)
      } else {
        newObj[key] = await asyncCallback(obj[key])
      }
    }
  }
  return newObj
}
