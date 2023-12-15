import _ from 'lodash'
import path from 'path'
import {createHash} from 'node:crypto'
import fs from 'fs'
import web3 from 'web3'

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
   * @constructor
   * @param {string} artworkWorkingFileUri - The URI of the artwork (normalized TOML header)
   * @param {object} artworkRelatedMetadata - The metadata from the TOML, ready to be used
   * @param {string|null} previewWorkingFileUri - The URI of the preview
   * @param {boolean} validate - If true, will do the validation regarding signed certificate, etc.
   */
  constructor(
      artworkWorkingFileUri,
      artworkRelatedMetadata,
      previewWorkingFileUri = null,
      validate = true) {
    this.#artworkMetadata = artworkRelatedMetadata
    this.#artworkUri = artworkWorkingFileUri
    this.#artworkPreviewUri = previewWorkingFileUri
    this._collectAssociatedMedia()
    // this._pointMediaToIpfs()
    if (validate) {
      this._validate()
    }
  }

  build = () => {
    // We don't want to mess with the original, as it might be needed elsewhere
    const metadataInProcess = _.cloneDeep(this.#artworkMetadata)

    // We only support schema.org for now, which is hardcoded
    delete metadataInProcess['@context']
    const tokenJsonObj = {
      '@context': 'https://schema.org/',
      '@type': metadataInProcess['@type'] ?? 'CreativeWork',
    }

    // const newMetadata = _.mapKeys(this.#artworkMetadata, (value, key) => {
    //
    // })
    // console.log(newMetadata)
  }

  /**
   * @method _collectAssociatedMedia
   * @private
   */
  _collectAssociatedMedia() {
    this._enrichSchemaAssociatedMedia(this.#artworkMetadata, {
      '@type': 'ImageObject',
      'identifier': path.basename(this.#artworkUri),
      // TODO: we don't want to set the contentUrl if we do the "unlockable content" - we're not going to publish it
      'contentUrl': this.#artworkUri,
      'thumbnailUrl': this.#artworkPreviewUri,
      'additionalProperty': {
        '@type': 'PropertyValue',
        'name': 'sha256',
        'value': createHash('sha256').update(fs.readFileSync(this.#artworkUri.replace('file://', ''))).digest('hex')
      }
    })

    this._enrichSchemaAssociatedMedia(this.#artworkMetadata, {
      '@type': 'ImageObject',
      'identifier': path.basename(this.#artworkPreviewUri),
      'contentUrl': this.#artworkPreviewUri,
      'additionalProperty': {
        '@type': 'PropertyValue',
        'name': 'sha256',
        'value': createHash('sha256')
            .update(fs.readFileSync(this.#artworkPreviewUri.replace('file://', ''))).digest('hex')
      }
    })

    const licenseUri = this.#artworkMetadata['schema:license']
    if (licenseUri) {
      this._enrichSchemaAssociatedMedia(this.#artworkMetadata, {
        '@type': path.extname(licenseUri).toLowerCase() === '.txt' ? 'TextObject' : 'MediaObject',
        'identifier': path.basename(licenseUri),
        'contentUrl': licenseUri,
        'additionalProperty': {
          '@type': 'PropertyValue',
          'name': 'sha256',
          'value': createHash('sha256')
              .update(fs.readFileSync(licenseUri.replace('file://', ''))).digest('hex')
        }
      })
    }

    const certificateUri = this.#artworkMetadata['XMP-dc:Certificate']
    if (certificateUri) {
      this._enrichSchemaAssociatedMedia(this.#artworkMetadata, {
        '@type': 'MediaObject',
        'identifier': path.basename(certificateUri),
        'contentUrl': certificateUri,
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
  }
}

/**
 * Generates an informational file to be included for convenience into the artefact
 * @param {object} metadata - The metadata to be included
 */
function _generateInfoDoc(metadata) {
  // TODO: implement generation of the informational doc
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
