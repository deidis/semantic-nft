import _ from 'lodash'
import path from 'path'
import {createHash} from 'node:crypto'
import fs from 'fs'
import web3 from 'web3'
import mime from 'mime'
import sharp from 'sharp'
import {calculateCID, calculateWrappedCID, ipfsUriToHttpsUri} from './ipfs.js'
import AdmZip from 'adm-zip'
import {updateObjectFieldWithAllSynonyms} from './vocabulary.js'
import {CERTIFICATE_FILE_NAME_WITHOUT_EXT, isSigned} from './certificate.js'

export const UNENCRYPTED_ARTEFACT_NAME_WITHOUT_EXTENSION = 'unencrypted_digital_artefact'
export const ENCRYPTED_ARTEFACT_NAME_WITHOUT_EXTENSION = 'eda'
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
  #associatedMediaUri
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
      previewWorkingFileUri = null,
  ) {
    this.#artworkMetadata = artworkRelatedMetadata
    this.#artworkUri = artworkWorkingFileUri
    this.#artworkPreviewUri = previewWorkingFileUri
    this.#artworkMimeType = mime.getType(this.#artworkUri)

    if (!this.#artworkMetadata['schema:encodingFormat']) {
      // We assume it's UDA.zip
      updateObjectFieldWithAllSynonyms(
          this.#artworkMetadata,
          'schema:encodingFormat',
          mime.getType(`${UNENCRYPTED_ARTEFACT_NAME_WITHOUT_EXTENSION}.zip`)
      )
    } else {
      // It's about EDA
    }

    const certificateUri = Object.keys(this.#artworkMetadata['XMP-xmpRights:Certificate'])[0]
    if (certificateUri) {
      // As it's defined, we are sure it must exist in the working folder.
      // So rather trust this fact instead of taking the path from the metadata, as it might not be fully prepared yet.
      const absolutePathToCertificate = path.dirname(this.#artworkUri.replace('file://', '')) +
          path.sep + CERTIFICATE_FILE_NAME_WITHOUT_EXT + '.pdf'

      if (certificateUri !== `file://${absolutePathToCertificate}`) {
        // This is normally made the same during certificate preparation,
        // so here we have a situation where we're only doing the validation
        this.#artworkMetadata['XMP-xmpRights:Certificate'][`file://${absolutePathToCertificate}`] =
            this.#artworkMetadata['XMP-xmpRights:Certificate'][certificateUri]
        delete this.#artworkMetadata['XMP-xmpRights:Certificate'][certificateUri]
      }
    }

    if (this.#artworkMetadata['schema:associatedMedia']?.['contentUrl']) {
      this.#associatedMediaUri = this.#artworkMetadata['schema:associatedMedia']['contentUrl']
    }
    delete this.#artworkMetadata['schema:associatedMedia']
  }

  build = async () => {
    const validate = false

    await this._collectAssociatedMedia()

    // TODO: (phase 1) modifyDate - when certificate was signed, now I simply use the current date
    // TODO: Make the dates fields with time 00:00:00 always, because we save without time in Schema
    // TODO: createDate, TODAY by default
    // TODO: UsageTerms-> include the text of the license if webContent isn't provided
    // TODO: copyright year
    // TODO: sameAs

    // TODO: (phase 3) if @type is ImageObject, additionally set height, width, contentUrl of the associated media artwork


    if (validate) {
      this._validate()
    }

    await this._generateInfoDoc()
    await this._package()
    this._appendDescriptionFooter()

    let tokenJsonObj = _.mapKeys(
        // It's not recursive, but the prefix is only used at the first level, so we're good
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

    fs.writeSync(
        fs.openSync(path.join(path.dirname(this.#artworkUri.replace('file://', '')), 'nft.json'), 'w'),
        JSON.stringify(tokenJsonObj, function(key, value) {
          switch (key) {
            case 'datePublished':
            case 'dateModified':
            case 'dateCreated':
              if (value.toISOString) {
                return value.toISOString().slice(0, 10)
              } else {
                return (new Date(Date.parse(value))).toISOString().slice(0, 10)
              }
          }

          return value
        }/* , 2 */)
    )
  }


  _generateInfoDoc = async () => {
    // TODO: (phoase 1) implement generation of the informational doc. Add it to nft.json as associated media
  }

  /**
   *
   * @param {object} metadata
   * @param {boolean} alsoUpload
   * @return {Promise<object>} an object where all the file:// entries are replaced with calculated CID (hence ipfs://...)
   * @private
   */
  _mapToIpfs = async (metadata, alsoUpload = false) => {
    if (alsoUpload || !alsoUpload) {
      return await _mapObjectRecursivelyAsync(metadata, async (value, key) => {
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
    if (this.#artworkMetadata['schema:encodingFormat'] !== 'application/zip') {
      throw Error(`Unsupported encoding format: ${this.#artworkMetadata['schema:encodingFormat']}`)
    }

    // TODO: (phase 2) detect if we want to package EDA (unlockable content), probably encodingFormat='application/png'?

    if (this.#artworkMetadata['schema:associatedMedia']) {
      const zip = new AdmZip()
      const outputFile = `${path.dirname(this.#artworkUri.replace('file://', ''))}`+
          path.sep + `${UNENCRYPTED_ARTEFACT_NAME_WITHOUT_EXTENSION}.zip`

      const allFiles = [outputFile]
      for (const associatedMedia of this.#artworkMetadata['schema:associatedMedia']) {
        if (!!associatedMedia['contentUrl']) {
          allFiles.push(associatedMedia['contentUrl'].replace('file://', ''))
          zip.addFile(
              path.basename(associatedMedia['contentUrl']),
              fs.readFileSync(associatedMedia['contentUrl'].replace('file://', ''))
          )
        }
      }
      await zip.writeZipPromise(outputFile)
      this._enrichSchemaAdditionalProperty({
        '@type': 'PropertyValue',
        'name': 'sha256',
        'value': createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex')
      })

      // All files when uploaded to IPFS will be wrapped in a directory
      const ipfsDirCID = await calculateWrappedCID(allFiles)
      this._enrichSchemaAdditionalProperty({
        '@type': 'PropertyValue',
        'name': 'directory',
        'value': `ipfs://${ipfsDirCID}`
      })

      if (!this.#artworkMetadata['nft:external_url']) {
        // NOTE: this is a user facing link normally presented by marketplaces. Hence, we show the web url on HTTPS
        this.#artworkMetadata['nft:external_url'] = ipfsUriToHttpsUri(ipfsDirCID)
      }

      if (!this.#artworkMetadata['schema:url']) {
        // NOTE: this is maybe confusing, but we're pointing to the packaged zip file,
        // as this is the real artefact that the token (schema.org/CreativeWork) represents.
        // There's a temptation to use the same url as nft:external_url, but that's questionable if it would be correct...
        // Because the sha256 is on the zip file, not on the directory.
        updateObjectFieldWithAllSynonyms(
            this.#artworkMetadata,
            'schema:url',
            `file://${outputFile}`,
            /* IMPORTANT! = false */false
        )
      }

      console.debug(`Created ${outputFile}`)
    } else {
      // Nothing to do
    }
  }

  // TODO: (phase 2) make this somehow configurable, as we don't have it the toml, therefore might be a surprise for the user
  _appendDescriptionFooter = () => {
    const hasDescription = this.#artworkMetadata['nft:description']
    let props = this.#artworkMetadata['schema:additionalProperty']
    if (props) {
      if (_isObject(props)) {
        props = [props]
      } else if (!Array.isArray(props)) {
        return
      }
    } else {
      return
    }

    let newDescription = this.#artworkMetadata['nft:description'] || ''

    if (props.length > 0) {
      if (hasDescription) {
        // newDescription = newDescription.trim() + '\n\n\n---\n\n\n'
        newDescription = newDescription.trim() + '\n\n'
      }
    }

    props.forEach((prop) => {
      if (prop['name'] === 'directory') {
        newDescription += `All files: [${prop['value']}](${ipfsUriToHttpsUri(prop['value'])})`
      }
    })

    // props.forEach((prop) => {
    //   if (prop['name'] === 'sha256') {
    //     newDescription += `Artefact sha256: ${prop['value']}\n\n`
    //   }
    // })

    // NOTE: schema:description and nft:description ends up to be the same thing, so use the overwriteSynanyms=true
    updateObjectFieldWithAllSynonyms(this.#artworkMetadata, 'nft:description', newDescription.trim(), true)
  }

  /**
   * @method _collectAssociatedMedia
   * @private
   */
  async _collectAssociatedMedia() {
    const artworkPubliclyAvailable = this.#artworkMetadata['schema:encodingFormat'] === 'application/zip'

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
      artworkMedia['url'] = this.#artworkUri
    }

    if (this.#artworkPreviewUri) {
      artworkMedia['thumbnailUrl'] = this.#artworkPreviewUri

      const artworkPreviewFileBuffer = fs.readFileSync(this.#artworkPreviewUri.replace('file://', ''))
      const artworkPreviewMedia = {
        '@type': 'ImageObject',
        'identifier': path.basename(this.#artworkPreviewUri),
        'name': _.capitalize(path.basename(this.#artworkPreviewUri, path.extname(this.#artworkPreviewUri))),
        'contentUrl': this.#artworkPreviewUri,
        'url': this.#artworkPreviewUri,
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

      if (!this.#artworkMetadata['nft:image_details']) {
        this.#artworkMetadata['nft:image_details'] = {
          'bytes': artworkPreviewMediaMetadata['size'],
          'width': artworkPreviewMediaMetadata['width'],
          'height': artworkPreviewMediaMetadata['height'],
          'sha256': createHash('sha256').update(artworkPreviewFileBuffer).digest('hex'),
          'format': mime.getType(this.#artworkPreviewUri).replace('image/', '').toUpperCase()
        }
      }

      artworkPreviewMedia['description'] = [
        `${artworkPreviewMediaMetadata.width} x ${artworkPreviewMediaMetadata.height}`,
        artworkPreviewMediaMetadata.width > artworkPreviewMediaMetadata.height ? 'landscape' : (
            artworkPreviewMediaMetadata.width < artworkPreviewMediaMetadata.height ? 'portrait' : 'square'),
        artworkPreviewMediaMetadata.density ?
            `${artworkPreviewMediaMetadata.density} pixels per ${artworkPreviewMediaMetadata.resolutionUnit}` : ''
      ].filter((section) => !!section).join(', ')

      this._enrichSchemaAssociatedMedia(artworkPreviewMedia)
    }

    this._enrichSchemaAssociatedMedia(artworkMedia)


    const licenseUri = this.#artworkMetadata['schema:license']
    if (licenseUri) {
      this._enrichSchemaAssociatedMedia({
        '@type': mime.getType(licenseUri).startsWith('text') ? 'TextObject' : 'MediaObject',
        'identifier': path.basename(licenseUri),
        'name': 'License',
        'contentUrl': licenseUri,
        'url': licenseUri,
        'encodingFormat': mime.getType(licenseUri),
        'contentSize': `${fs.statSync(licenseUri.replace('file://', '')).size}`,
      })

      if (licenseUri.startsWith('file://')) {
        this._enrichSchemaAssociatedMedia({
          'identifier': path.basename(licenseUri),
          'additionalProperty': {
            '@type': 'PropertyValue',
            'name': 'sha256',
            'value': createHash('sha256')
                .update(fs.readFileSync(licenseUri.replace('file://', ''))).digest('hex')
          }
        })
      }
    }

    const certificateUri = Object.keys(this.#artworkMetadata['XMP-xmpRights:Certificate'])[0]
    if (certificateUri) {
      this._enrichSchemaAssociatedMedia({
        '@type': 'MediaObject', // Maybe use LegislationObject?
        'identifier': path.basename(certificateUri),
        'name': 'Certificate of Authenticity',
        'contentUrl': certificateUri,
        'url': certificateUri,
        'encodingFormat': mime.getType(certificateUri),
        'contentSize': `${fs.statSync(certificateUri.replace('file://', '')).size}`,
        'additionalProperty': {
          '@type': 'PropertyValue',
          'name': 'sha256',
          'value': createHash('sha256')
              .update(fs.readFileSync(certificateUri.replace('file://', ''))).digest('hex')
        },
      })
    }

    if (this.#associatedMediaUri) {
      const associatedMediaFileBuffer = fs.readFileSync(this.#associatedMediaUri.replace('file://', ''))
      const associatedMediaMime = mime.getType(this.#associatedMediaUri)
      const associatedMediaId = this.#artworkMetadata['schema:associatedMedia']['id'] ||
          path.basename(this.#associatedMediaUri)
      const associatedMediaName = this.#artworkMetadata['schema:associatedMedia']['name'] ||
          _.capitalize(path.basename(this.#associatedMediaUri, path.extname(this.#associatedMediaUri)))

      const associatedMedia = {
        '@type': associatedMediaMime.startsWith('image') ? 'ImageObject' :
            (associatedMediaMime.startsWith('text') ? 'TextObject' :
                (associatedMediaMime.startsWith('video') ? 'VideoObject' :
                    (associatedMediaMime.startsWith('audio') ? 'AudioObject' :
                        (associatedMediaMime === 'model/stl' ? '3DModel' : 'MediaObject')))),
        'identifier': associatedMediaId,
        'name': associatedMediaName,
        'contentUrl': this.#associatedMediaUri,
        'url': this.#associatedMediaUri,
        'encodingFormat': associatedMediaMime,
        'contentSize': `${fs.statSync(this.#associatedMediaUri.replace('file://', '')).size}`,
        'additionalProperty': {
          '@type': 'PropertyValue',
          'name': 'sha256',
          'value': createHash('sha256').update(associatedMediaFileBuffer).digest('hex')
        }
      }

      if (associatedMediaMime.startsWith('image')) {
        const associatedMediaMetadata = await sharp(associatedMediaFileBuffer).metadata()
        associatedMedia['contentSize'] = `${associatedMediaMetadata['size']}`
        associatedMedia['width'] = `${associatedMediaMetadata['width']}`
        associatedMedia['height'] = `${associatedMediaMetadata['height']}`

        associatedMedia['description'] = [
          `${associatedMediaMetadata.width} x ${associatedMediaMetadata.height}`,
          associatedMediaMetadata.width > associatedMediaMetadata.height ? 'landscape' : (
              associatedMediaMetadata.width < associatedMediaMetadata.height ? 'portrait' : 'square'),
          associatedMediaMetadata.density ?
              `${associatedMediaMetadata.density} pixels per ${associatedMediaMetadata.resolutionUnit}` : ''
        ].filter((section) => !!section).join(', ')
      }
      this._enrichSchemaAssociatedMedia(associatedMedia)
    }
  }

  /**
   * @method _enrichSchemaAssociatedMedia
   * @param {object} associatedMediaObjectMetadata
   * @private
   */
  _enrichSchemaAssociatedMedia(associatedMediaObjectMetadata) {
    const artworkMetadata = this.#artworkMetadata
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
   * @method _enrichSchemaAssociatedMedia
   * @param {object} additionalPropertyObjectMetadata
   * @private
   */
  _enrichSchemaAdditionalProperty(additionalPropertyObjectMetadata) {
    const artworkMetadata = this.#artworkMetadata
    if (artworkMetadata['schema:additionalProperty'] === undefined) {
      artworkMetadata['schema:additionalProperty'] = additionalPropertyObjectMetadata
      return
    } else {
      if (_isObject(artworkMetadata['schema:additionalProperty'])) {
        artworkMetadata['schema:additionalProperty'] = [artworkMetadata['schema:additionalProperty']]
      }
    }

    let foundAt = -1
    artworkMetadata['schema:additionalProperty'].forEach((obj, index) => {
      if (obj['name'] === additionalPropertyObjectMetadata['name']) {
        foundAt = index
      }
    })
    if (foundAt !== -1) {
      _.merge(artworkMetadata['schema:additionalProperty'][foundAt], additionalPropertyObjectMetadata)
    } else {
      artworkMetadata['schema:additionalProperty'].push(additionalPropertyObjectMetadata)
    }
  }

  /**
   * @method _validate
   */
  _validate() {
    // Validate the identifier
    // We expect: urn:<blockchain>:<collectionid>:<tokenid>
    const id = this.#artworkMetadata['XMP-dc:Identifier'] || ''
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

    const certificateUri = Object.keys(this.#artworkMetadata['XMP-xmpRights:Certificate'])[0]
    if (certificateUri) {
      // As it's defined, we are sure it must exist in the working folder.
      // So rather trust this fact instead of taking the path from the metadata, as it might not be fully prepared yet.
      const absolutePathToCertificate = path.dirname(this.#artworkUri.replace('file://', '')) +
          path.sep + CERTIFICATE_FILE_NAME_WITHOUT_EXT + '.pdf'

      if (!fs.existsSync(absolutePathToCertificate)) {
        throw new Error(`Certificate file ${absolutePathToCertificate} does not exist`)
      }
      if (!isSigned(absolutePathToCertificate)) {
        throw new Error(`Certificate file ${absolutePathToCertificate} is not signed`)
      }

      // TODO: (phase 2) for extra caution we might want to check if content valid
    }

    if (!this.#artworkMetadata['nft:name']) {
      throw new Error(`NFT name is not set`)
    }
  }
}

/**
 * Check if the variable is an object
 * @param {*} variable
 * @return {boolean}
 * @private
 */
function _isObject(variable) {
  return typeof variable === 'object' && variable !== null && !Array.isArray(variable) && !(variable instanceof Date)
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
      if (typeof obj[key] === 'object' && !(obj[key] instanceof Date)) {
        if (Array.isArray(obj[key])) {
          newObj[key] = []
          for (const item of obj[key]) {
            newObj[key].push(await _mapObjectRecursivelyAsync(item, asyncCallback))
          }
        } else {
          newObj[key] = await _mapObjectRecursivelyAsync(obj[key], asyncCallback)
        }
      } else {
        newObj[key] = await asyncCallback(obj[key], key)
      }
    }
  }
  return newObj
}
