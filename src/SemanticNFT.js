import _ from 'lodash'

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
