import path from 'path'
import fs from 'fs'
import TOML from '@iarna/toml'
import {collectFiles, SUPPORTED_IMAGE_FILE_TYPES} from './collectFiles.js'
import {exiftool} from 'exiftool-vendored'
import {
  ARTWORK_FILE_NAME_WITHOUT_EXT,
  ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT,
} from './artwork.js'
import {CERTIFICATE_FILE_NAME_WITHOUT_EXT, CERTIFICATE_SUPPORTED_INFO_TAGS, isSigned} from './certificate.js'
import _ from 'lodash'
import {fileUriToIpfsUri} from './ipfs.js'
import {deleteObjectFieldWithAllSynonyms, lookupQualifiedName, updateObjectFieldWithAllSynonyms} from './vocabulary.js'

const __METADATA_CACHE = {}
const __CACHE_KEY = (tomlFileAbsolutePaths) => {
  return tomlFileAbsolutePaths.sort().join('|')
}

/**
 * Ingests the given TOML files into images
 * @param {string[]|undefined|null} metadata - Absolute paths to the TOML files
 * @return {Promise<void>}
 */
export async function ingest(metadata) {
  metadata = metadata || _getMetadata()
  // console.debug(JSON.stringify(metadata, null, 2))
  const commonMetadata = commonMetadataForAllArtworks(metadata)
  const ingestingPromises = []
  artworkURIs().forEach((artworkURI) => {
    const artworkAbsolutePath = artworkURI.replace('file://', '')
    const previewAbsolutePath = path.dirname(artworkAbsolutePath) +
        path.sep +
        ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT +
        artworkPreviewFileExtension(artworkAbsolutePath, metadata)

    // TODO: (phase 3) make this configurable. Artists may not want to touch the artwork file at all, not even the metadata
    const ingestMetadata = {...commonMetadata, ...metadata[artworkURI]}
    ingestingPromises.push(_ingestMetadataForSpecificArtwork(artworkURI, ingestMetadata).then(() => {
      console.log(`Ingested metadata into ${artworkAbsolutePath}`)
    }).catch((err) => {
      console.error(`ERROR: Failed to ingest metadata into ${artworkAbsolutePath}: ${err}`)
    }))

    if (fs.existsSync(previewAbsolutePath)) {
      if (metadata[`file://${previewAbsolutePath}`]) {
        Object.assign(ingestMetadata, metadata[`file://${previewAbsolutePath}`])
      }
      ingestingPromises.push(_ingestMetadataForSpecificArtwork(previewAbsolutePath, ingestMetadata).then(() => {
        console.log(`Ingested metadata into ${previewAbsolutePath}`)
      }).catch((err) => {
        console.error(`ERROR: Failed to ingest metadata into ${previewAbsolutePath}: ${err}`)
      }))
    }
  })

  return Promise.all(ingestingPromises).then(() => {
    // Get rid of empty fields as they are just noise at this point
    Object.keys(metadata).forEach((key) => {
      const value = metadata[key]
      if (_isObject(value) && Object.keys(value).length === 0) {
        delete metadata[key]
      } else if (Array.isArray(value) && value.length === 0) {
        delete metadata[key]
      } else if (typeof value === 'string' && value.trim().length === 0) {
        delete metadata[key]
      }
    })

    // Now let's add all global metadata into every artwork, as that the artwork table is actually the source of truth
    artworkURIs().forEach((artworkURI) => {
      // License and certificate are handled separately, everything else is not so special
      const commonOverwritable = _.cloneDeep(commonMetadata)
      _.merge(commonOverwritable, metadata[artworkURI])
      _.merge(metadata[artworkURI], commonOverwritable)
    })

    // Get rid of the common metadata, as it's not needed anymore
    Object.keys(metadata).filter((key) => !key.startsWith('file://')).forEach((key) => {
      delete metadata[key]
    })
  })
}

/**
 * Deletes all metadata for the given files
 * @method
 * @param {string[]} absoluteFilePaths - List of files for which we want to clean up the metadata
 * @param {boolean} overwrite - Whether to overwrite the original file or not
 * @return {Promise} Promise object represents the result of the operation
 */
export function clean(absoluteFilePaths, overwrite = true) {
  const promises = []
  absoluteFilePaths.forEach((file) => {
    let p
    if (overwrite) {
      p = exiftool.write(file, {}, ['-all=', '-overwrite_original']).catch(_successfulCatch)
    } else {
      p = exiftool.deleteAllTags(file).catch(_successfulCatch)
    }

    promises.push(p)
  })
  return Promise.all(promises)
}

/**
 * Ingests the given metadata into the given artwork file
 * @param {string} artworkPathOrUri
 * @param {object} tags
 * @return {Promise<void>}
 * @private
 */
async function _ingestMetadataForSpecificArtwork(artworkPathOrUri, tags) {
  const artworkPath = artworkPathOrUri.replace('file://', '')
  const tagsAdjusted = {...tags}

  // Flatten the certificate information for exiftool
  if (_isObject(tagsAdjusted['XMP-xmpRights:Certificate'])) {
    tagsAdjusted['XMP-xmpRights:Certificate'] = Object.keys(tagsAdjusted['XMP-xmpRights:Certificate'])[0]
  }

  // Maybe we haven't uploaded certificate nor license yet, but we will want to reference to them via IPFS
  if (tagsAdjusted['XMP-xmpRights:WebStatement']) {
    tagsAdjusted['XMP-xmpRights:WebStatement'] = await fileUriToIpfsUri(tagsAdjusted['XMP-xmpRights:WebStatement'])
  }
  if (tagsAdjusted['XMP-xmpRights:Certificate']) {
    if (isSigned(tagsAdjusted['XMP-xmpRights:Certificate'])) {
      tagsAdjusted['XMP-xmpRights:Certificate'] = await fileUriToIpfsUri(tagsAdjusted['XMP-xmpRights:Certificate'])
    } else {
      // Well... the certificate is useless, as it's not signed.
      // It must be added to metadata afterward, when it's signed.
      delete tagsAdjusted['XMP-xmpRights:Certificate']
    }
  }

  // Only keep the metadata that makes sense for exiftool
  Object.keys(tagsAdjusted).forEach((key) => {
    if (key.startsWith('schema:') || key.startsWith('nft:')) {
      // Schema.org fields or nft specific fields are not intended for exiftool
      delete tagsAdjusted[key]
    }
  })

  // Convert dates to Exiftool dates
  Object.keys(tagsAdjusted).forEach((key) => {
    if (['XMP-dc:Date'].includes(key)) {
      tagsAdjusted[key] = tagsAdjusted[key].toISOString().slice(0, 10)
    }
    if (['Exif:ModifyDate', 'Exif:CreateDate', 'Exif:DateTimeOriginal'].includes(key)) {
      tagsAdjusted[key] = tagsAdjusted[key].toISOString()
    }
  })

  await exiftool.write(artworkPath, tagsAdjusted, ['-xmptoolkit=', '-overwrite_original'])
}

/**
 * Prepares or retrieves the metadata from the cache.
 *
 * @param {string[]|undefined|null} tomlFileAbsolutePaths - Absolute paths to the TOML files
 * @return {object} - The TOML files as JSON
 */
function _getMetadata(tomlFileAbsolutePaths) {
  if (typeof tomlFileAbsolutePaths === 'undefined' || tomlFileAbsolutePaths === null) {
    if (Object.keys(__METADATA_CACHE).length === 0) {
      console.warn('Metadata has not been initialized!')
      return {}
    } else {
      // Normally it's only one record in the cache anyway
      return __METADATA_CACHE[Object.keys(__METADATA_CACHE)[0]]
    }
  }

  return prepareMetadata(tomlFileAbsolutePaths)
}

/**
 * Merge all the TOML files into a single JSON object.
 * Also resolve the table headers into absolute artwork file paths
 *
 * @param {string[]} tomlFileAbsolutePaths
 * @return {object} - The TOML files as JSON
 */
export function prepareMetadata(tomlFileAbsolutePaths) {
  const cachekey = __CACHE_KEY(tomlFileAbsolutePaths)
  if (__METADATA_CACHE[cachekey]) {
    return __METADATA_CACHE[cachekey]
  }
  const result = {}

  //
  // Merge all the TOML files into a single JSON object and normalize the toml headers as they should represent artworks
  //
  tomlFileAbsolutePaths.forEach((tomlFileAbsolutePath) => {
    const tomlFile = fs.readFileSync(tomlFileAbsolutePath, 'utf8')
    const tomlJson = TOML.parse(tomlFile)
    // NOTE: This is a shallow merge, so if there are duplicate keys, the last one wins
    Object.assign(result, tomlJson)

    // Now resolve the table headers into absolute file paths
    const describedArtworks = _mentionedArtworks(tomlFileAbsolutePath, tomlJson)
    for (const tomlTableHeader in describedArtworks) {
      if (Object.keys(tomlJson[tomlTableHeader]).length !== 0) {
        const artworkFileAbsolutePaths = describedArtworks[tomlTableHeader] || []
        artworkFileAbsolutePaths.forEach((artworkFileAbsolutePath) => {
          const artworkFileURI = `file://${artworkFileAbsolutePath}`
          result[artworkFileURI] = result[artworkFileURI] || {}
          result[artworkFileURI] = Object.assign(result[artworkFileURI], tomlJson[tomlTableHeader])
        })
        delete result[tomlTableHeader]
      }
    }
  })

  // The order of calling these functions is important here!
  _normalizeFields(result)
  _prepareMetadataOfLicenses(result)
  _prepareMetadataOfCertificates(result)

  // Only this one is currently supported
  result['schema:@context'] = 'https://schema.org/'

  // Default type
  if (!result['schema:@type']) {
    updateObjectFieldWithAllSynonyms(result, 'schema:@type', 'CreativeWork', false)
  }

  // Default copyright holder
  if (!result['schema:copyrightHolder']) {
    if (result['schema:creator']) {
      updateObjectFieldWithAllSynonyms(result, 'schema:copyrightHolder', result['schema:creator'], false)
    }
  }

  // Default datePublished
  let datePublished = result['schema:datePublished']
  if (!datePublished) {
    datePublished = new Date()
  }

  updateObjectFieldWithAllSynonyms(
      result,
      'schema:datePublished',
      datePublished,
      false)

  if (!result['schema:version']) {
    updateObjectFieldWithAllSynonyms(result, 'schema:version', 1, false)
  }

  __METADATA_CACHE[cachekey] = result

  return result
}

/**
 * @param {string} absoluteTomlFilePath - Absolute path to the toml file
 * @param {object} tomlJson - parsed toml file
 * @return {{string: string[]}} - A map of headers to absolute paths to the artwork files
 * @private
 */
function _mentionedArtworks(absoluteTomlFilePath, tomlJson) {
  /** @type {{string: string[]}} */
  const result = {}

  // Iterate over json and find the keys that are mapped to an object
  // eslint-disable-next-line guard-for-in
  for (const tomlJsonKey in tomlJson) {
    const value = tomlJson[tomlJsonKey]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // We found a table in toml, which in our case means that it's about an artwork.
      /*
       * Resolve the path to the working file of the artwork,
       * which is supposed to be in a subfolder of the directory where the toml file is.
       * For example, the toml file may have:
       * ["portrait.png"]
       * ...
       * ["landscape"]
       * ...
       * ["/home/abc/square.png"]
       * ...
       */
      const artworkTomlHeader = tomlJsonKey
      const artworkFileNameWithoutExtension = path.basename(artworkTomlHeader, path.extname(artworkTomlHeader))

      // Just get rid of the wildcard, which is just syntactic sugar
      let artworkPathWithoutWildcard = artworkTomlHeader
      if (artworkTomlHeader.endsWith('*')) {
        artworkPathWithoutWildcard = artworkTomlHeader.substring(0, artworkTomlHeader.length - 1)
      }

      if (artworkPathWithoutWildcard.endsWith('/')) {
        let searchPath = artworkPathWithoutWildcard
        if (!path.isAbsolute(artworkPathWithoutWildcard)) {
          searchPath = path.resolve(path.dirname(absoluteTomlFilePath) +
              path.sep +
              artworkPathWithoutWildcard)
        }
        result[artworkTomlHeader] = collectFiles(searchPath, 0)
      } else {
        let searchPath = artworkPathWithoutWildcard
        if (!path.isAbsolute(artworkPathWithoutWildcard)) {
          searchPath = path.resolve(path.dirname(absoluteTomlFilePath) +
              path.sep +
              artworkPathWithoutWildcard)
        }

        const fileNameGivenWithExtension = path.extname(artworkPathWithoutWildcard).length > 1
        if (!fileNameGivenWithExtension) {
          searchPath = path.dirname(searchPath)
        }

        // Before jumping into the search, let's see if we are referring
        // to a preview files (which may not yet exist, e.g. during the first run).
        // This would be used to set the metadata for yet to be created preview image,
        // but that image must have the extension provided
        // (which is also serves as the instruction of which mime type to use for preview)

        if (fileNameGivenWithExtension) {
          if (artworkFileNameWithoutExtension === ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT) {
            result[artworkTomlHeader] = [searchPath]
          } else {
            result[artworkTomlHeader] = collectFiles(searchPath, 0)
          }
        } else {
          result[artworkTomlHeader] = collectFiles(searchPath, 0).filter((filePath) => {
            return path.basename(filePath).
                startsWith(artworkFileNameWithoutExtension)
          })
        }
      }

      if (result[artworkTomlHeader].length === 0) {
        delete result[artworkTomlHeader]
      }
    }
  }

  return result
}

const commonMetadataForAllArtworks = (metadata) => {
  const tomlJson = metadata || _getMetadata()
  const result = {}
  for (const tomlJsonKey in tomlJson) {
    if (tomlJsonKey.startsWith('file://')) {
      continue
    }
    result[tomlJsonKey] = tomlJson[tomlJsonKey]
  }

  return result
}

export const artworkPaths = (metadata) => {
  return artworkURIs(metadata).map((key) => {
    return key.replace('file://', '')
  })
}

export const artworkURIs = (metadata) => {
  return Object.keys(metadata || _getMetadata()).filter((key) => {
    return key.startsWith('file://')
  }).filter((uri, index, uris) => {
    // If the uri is a preview image of some artwork, then we don't want to include it
    if (path.basename(uri, path.extname(uri)).endsWith(ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT)) {
      const previewUri = uri
      // check if it's a preview of already included artwork
      return uris.filter((uriToCheck) => {
        if (path.basename(uriToCheck, path.extname(uriToCheck)) === ARTWORK_FILE_NAME_WITHOUT_EXT) {
          // We have the artwork in working file uri
          if (path.basename(path.dirname(uriToCheck)) === path.basename(path.dirname(previewUri))) {
            return previewUri.startsWith(path.dirname(uriToCheck))
          }
        } else {
          return previewUri.startsWith(`${path.dirname(uriToCheck)}`+
              `/${path.basename(uriToCheck, path.extname(uriToCheck))}`)
        }
      }).length === 1 // If we found only itself, then it's an artwork named "preview"
    }
    return SUPPORTED_IMAGE_FILE_TYPES.includes(path.extname(uri).toLowerCase().replace('.', ''))
  })
}

export const artworkPreviewFileExtension = (artworkAbsolutePathOrUri, metadata) => {
  const artworkNameWithoutExt = path.basename(artworkAbsolutePathOrUri, path.extname(artworkAbsolutePathOrUri))
  const artworkAbsolutePath = artworkAbsolutePathOrUri.replace('file://', '')
  const isWorkingDir = (artworkNameWithoutExt === ARTWORK_FILE_NAME_WITHOUT_EXT)

  const filtered = Object.keys(metadata || _getMetadata()).filter((key) => {
    if (isWorkingDir) {
      return key.startsWith(`file://${path.dirname(artworkAbsolutePath)}/${ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT}`)
    } else {
      return key.startsWith(`file://${path.dirname(artworkAbsolutePath)}`+
          `/${path.basename(artworkAbsolutePath, path.extname(artworkAbsolutePath))}`+
          `/${ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT}`)
    }
  })

  if (filtered.length === 1) {
    return path.extname(filtered[0])
  } else {
    return path.extname(artworkAbsolutePath)
  }
}

/**
 * For some reason exiftool-vendored is throwing an error when we try to clear all metadata multiple times
 * @param {Error} err
 * @return {string}
 * @private
 */
function _successfulCatch(err) {
  if (err.message.startsWith('No success message')) {
    return 'No success message. Consider successful.'
  } else {
    throw err
  }
}

/**
 * Normalizes the field names in the metadata. Such things like "license" will become "XMP-xmpRights:WebStatement" and so on.
 *
 * This method does NOT normalize the field names within the "XMP-xmpRights:Certificate" as it's something
 * to be done during _prepareMetadataOfCertificates() method.
 *
 * @param {Object} metadata
 * @private
 */
function _normalizeFields(metadata) {
  Object.keys(metadata).forEach((key) => {
    if (!_isObject(metadata[key])) {
      const thisKey = lookupQualifiedName(key, metadata[key], false)
      if (thisKey && thisKey !== key) {
        metadata[thisKey] = _.isString(metadata[key]) ? metadata[key].trim() : metadata[key]
        delete metadata[key]
        key = thisKey
      } else {
        metadata[key] = _.isString(metadata[key]) ? metadata[key].trim() : metadata[key]
      }

      updateObjectFieldWithAllSynonyms(metadata, key, metadata[key], false)
    }
  })
  artworkURIs(metadata).forEach((artworkURI) => {
    Object.keys(metadata[artworkURI]).forEach((key) => {
      const thisKey = lookupQualifiedName(key, metadata[artworkURI][key], false)
      if (thisKey && thisKey !== key) {
        metadata[artworkURI][thisKey] = _.isString(metadata[artworkURI][key]) ?
            metadata[artworkURI][key].trim() : metadata[artworkURI][key]
        delete metadata[artworkURI][key]
        key = thisKey
      } else {
        metadata[artworkURI][key] = _.isString(metadata[artworkURI][key]) ?
            metadata[artworkURI][key].trim() : metadata[artworkURI][key]
      }

      if (key === 'XMP-dc:Identifier') {
        // We expect: urn:<blockchain>:<collectionid>:<tokenid>
        const keyParts = metadata[artworkURI][key].split(':')
        if (keyParts.length === 4) {
          metadata[artworkURI][key] = keyParts.map((part, index) => {
            return index === 2 ? part : part.toLowerCase()
          }).join(':')
        }
      }

      updateObjectFieldWithAllSynonyms(metadata[artworkURI], key, metadata[artworkURI][key], false)
    })
  })

  // TODO: (phase 2) resolve the variables
}

/**
 * Adjusts the metadata related to licenses
 * @param {object} metadata
 * @private
 */
function _prepareMetadataOfLicenses(metadata) {
  artworkURIs(metadata).forEach((artworkURI) => {
    const localLicense = metadata[artworkURI]['XMP-xmpRights:WebStatement']
    if (localLicense) {
      const absoluteFilePath = collectFiles(path.resolve(localLicense), 0, '*').pop()
      if (absoluteFilePath) {
        updateObjectFieldWithAllSynonyms(metadata[artworkURI], 'XMP-xmpRights:WebStatement', `file://${absoluteFilePath}`)
      } else {
        if (!URL.canParse(localLicense)) {
          // Get rid of the invalid license
          deleteObjectFieldWithAllSynonyms(metadata[artworkURI], 'XMP-xmpRights:WebStatement')
        } else {
          // Trust that it's a URL
        }
      }
    }
  })


  const globalLicense = metadata['XMP-xmpRights:WebStatement']
  if (globalLicense) {
    const absoluteFilePath = collectFiles(path.resolve(globalLicense), 0, '*').pop()
    if (absoluteFilePath) {
      updateObjectFieldWithAllSynonyms(metadata, 'XMP-xmpRights:WebStatement', `file://${absoluteFilePath}`)
      artworkURIs(metadata).forEach((artworkURI) => {
        if (!metadata[artworkURI]['XMP-xmpRights:WebStatement']) {
          updateObjectFieldWithAllSynonyms(metadata[artworkURI], 'XMP-xmpRights:WebStatement', `file://${absoluteFilePath}`)
        }
      })
    } else {
      if (!URL.canParse(globalLicense)) {
        // Ignore the globally set license
      } else {
        // Trust that it's a URL
        artworkURIs(metadata).forEach((artworkURI) => {
          if (!metadata[artworkURI]['XMP-xmpRights:WebStatement']) {
            updateObjectFieldWithAllSynonyms(metadata[artworkURI], 'XMP-xmpRights:WebStatement', globalLicense)
          }
        })
      }
    }
  }

  // By now we should have the licenses (if prescribed) in the context of evry artwork, so delete the field globally
  delete metadata['XMP-xmpRights:WebStatement']

  // TODO: (phase 2) what if we have other licenses which are equivalent to public domain?
  const publicDomainLicenseName = 'CC0'

  artworkURIs(metadata).forEach((artworkURI) => {
    if (metadata[artworkURI]['XMP-xmpRights:WebStatement']) {
      if (!metadata[artworkURI]['XMP-xmpRights:Marked']) {
        if (!path.basename(metadata[artworkURI]['XMP-xmpRights:WebStatement']).startsWith(publicDomainLicenseName)) {
          updateObjectFieldWithAllSynonyms(metadata[artworkURI], 'XMP-xmpRights:Marked', 'true', false)
        }
      } else {
        metadata[artworkURI]['XMP-xmpRights:Marked'] = (
            metadata[artworkURI]['XMP-xmpRights:Marked'].toString() === 'false' ? 'false' : 'true'
        )
      }
    }
  })
}

/**
 * Adjusts the metadata related to certificates
 * @param {object} metadata
 * @private
 */
function _prepareMetadataOfCertificates(metadata) {
  _normalizeCertificateFieldNames(metadata['XMP-xmpRights:Certificate'])
  let globalCertificatePath = metadata['XMP-xmpRights:Certificate']

  // If the certificate isn't provided for an artwork should we force empty or fallback to a default?
  const globalCertificatePathIsInlineTable = _isObject(globalCertificatePath)
  if (globalCertificatePathIsInlineTable) {
    globalCertificatePath = Object.keys(globalCertificatePath)[0]
  }

  const forceEmptyIfNotPresentLocally = !globalCertificatePath && (typeof globalCertificatePath !== 'undefined')

  if (!forceEmptyIfNotPresentLocally && globalCertificatePath &&
      !path.isAbsolute(globalCertificatePath) && !globalCertificatePath.startsWith('.')) {
    console.warn(`Falling back to the default certificate path: ${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`)
    globalCertificatePath = `./${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`
  }

  // Check the global certificate, and use it for artworks where certificate wasn't provided


  // collect referenced certificate, turn them into URIs beforehand
  const artworksNotReferencingCertificateUris = []
  /** @type {[string|object][]} */
  const referencedCertificateUris = artworkURIs(metadata).map((uri) => {
    _normalizeCertificateFieldNames(metadata[uri]['XMP-xmpRights:Certificate'])
    let certificatePath = metadata[uri]['XMP-xmpRights:Certificate']
    const certificatePathIsInlineTable = (typeof certificatePath === 'object' &&
        certificatePath !== null &&
        !Array.isArray(certificatePath))
    if (certificatePathIsInlineTable) {
      certificatePath = Object.keys(certificatePath)[0]
    }

    if (certificatePath && path.extname(certificatePath).toLowerCase() === '.pdf') {
      if (!certificatePath.startsWith('file://')) {
        if (path.isAbsolute(certificatePath)) {
          certificatePath = `file://${certificatePath}`
        } else {
          // Relative paths are relative to the artwork file
          const originalArtworkNameWithoutExt = path.basename(uri, path.extname(uri))
          const absoluteDir = path.dirname(uri).replace('file://', '')

          if (!certificatePath.startsWith('.')) {
            certificatePath = `./${certificatePath}`
          }

          if (!certificatePath.endsWith(`${originalArtworkNameWithoutExt}/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`)) {
            certificatePath = certificatePath.replace(
                `/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`,
                `/${originalArtworkNameWithoutExt}/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`
            )
          }

          // Now resolve the relative path to the absolute path
          certificatePath = path.resolve(absoluteDir + path.sep + certificatePath)
        }
      } else {
        // All good, it's already globally written with file://
      }
    }

    if (certificatePathIsInlineTable) {
      const inlineTable = Object.values(metadata[uri]['XMP-xmpRights:Certificate'])[0]
      delete metadata[uri]['XMP-xmpRights:Certificate'][
          Object.keys(metadata[uri]['XMP-xmpRights:Certificate'])[0]
      ]
      metadata[uri]['XMP-xmpRights:Certificate'][`file://${certificatePath}`] = inlineTable
    } else {
      if (certificatePath) {
        metadata[uri]['XMP-xmpRights:Certificate'] = `file://${certificatePath}`
      }
    }


    if (typeof metadata[uri]['XMP-xmpRights:Certificate'] === 'undefined') {
      artworksNotReferencingCertificateUris.push(uri)
    }

    return metadata[uri]['XMP-xmpRights:Certificate']
  }).filter((mappedCertificateUri) => !!mappedCertificateUri)

  // Adjust the toml table headers that represent certificates. And some other stuff on the way...
  Object.keys(metadata).filter((key) => {
    return !key.startsWith('file://') && key.endsWith(`.pdf`)
  }).forEach((certificatePath) => {
    _normalizeCertificateFieldNames({[certificatePath]: metadata[certificatePath]})
    if (path.isAbsolute(certificatePath)) {
      if (referencedCertificateUris
          .map((ref) => _isObject(ref) ? Object.keys(ref)[0] : ref).includes(`file://${certificatePath}`)) {
        metadata[`file://${certificatePath}`] = metadata[certificatePath]
        delete metadata[certificatePath]
      } else {
        artworkURIs(metadata).filter((uri) => {
          return uri.startsWith(`file://${path.dirname(certificatePath)}`)
        }).forEach((uri) => {
          if (typeof metadata[uri]['XMP-xmpRights:Certificate'] !== 'undefined') {
            // Force it to be empty
            delete metadata[certificatePath]
          } else {
            if (forceEmptyIfNotPresentLocally) {
              // Force it to be empty
              delete metadata[certificatePath]
            } else {
              // Fix the reference
              metadata[uri]['XMP-xmpRights:Certificate'] = `file://${certificatePath}`
              metadata[`file://${certificatePath}`] = metadata[certificatePath]
              referencedCertificateUris.push(`file://${certificatePath}`)
              delete metadata[certificatePath]
            }
          }
        })
      }
    } else {
      // Relative paths are relative to the artwork file
      const artworkNameWithoutExt = path.basename(path.dirname(certificatePath))
      if (artworkNameWithoutExt.endsWith('.') && artworkNameWithoutExt.startsWith('.')) {
        console.error(`Certificate context not provided in ${certificatePath}. It should be <artwork>/<certificate>.pdf`)
      } else {
        let adjustedCertificatePath = certificatePath.replace(
            `${artworkNameWithoutExt}/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`,
            `${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`
        )

        if (!adjustedCertificatePath.startsWith('.')) {
          adjustedCertificatePath = `./${adjustedCertificatePath}`
        }

        if (!adjustedCertificatePath.endsWith(`/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`)) {
          // We have some custom certificate file name, so we will be trying to copy it over later one
          artworkURIs(metadata).forEach((uri) => {
            if (path.basename(uri, path.extname(uri)) === artworkNameWithoutExt) {
              let specificCertificateUri = metadata[uri]['XMP-xmpRights:Certificate']
              const specificCertificateUriIsInlineTable = (typeof specificCertificateUri === 'object' &&
                  specificCertificateUri !== null &&
                  !Array.isArray(specificCertificateUri))
              if (specificCertificateUriIsInlineTable) {
                specificCertificateUri = Object.keys(specificCertificateUri)[0]
              }
              if (!specificCertificateUri && typeof specificCertificateUri === 'undefined') {
                specificCertificateUri = 'file://' +
                    path.resolve(path.dirname(uri).replace('file://', '') +
                        path.sep +
                        // Artwork name is only for navigation, let's get rid of it
                        adjustedCertificatePath.replace(`./${artworkNameWithoutExt}/`, './')
                    )
                if (path.basename(specificCertificateUri) === path.basename(adjustedCertificatePath)) {
                  metadata[uri]['XMP-xmpRights:Certificate'] = {
                    [specificCertificateUri]: metadata[certificatePath]
                  }
                }
                referencedCertificateUris.push(specificCertificateUri)
              } else {
                if (specificCertificateUri) {
                  // Artwork name is only for navigation, let's get rid of it
                  const pieces = specificCertificateUri.split('/')
                  if (pieces[pieces.length - 2] === artworkNameWithoutExt) {
                    pieces.splice(-2, 1)
                  }
                  specificCertificateUri = pieces.join('/')
                  if (specificCertificateUriIsInlineTable) {
                    metadata[uri]['XMP-xmpRights:Certificate'] = {
                      [specificCertificateUri]: {
                        ...metadata[uri]['XMP-xmpRights:Certificate'][specificCertificateUri],
                        ...metadata[certificatePath]
                      }
                    }
                  } else {
                    metadata[uri]['XMP-xmpRights:Certificate'] = specificCertificateUri
                  }
                } else {
                  // Force it to be empty
                }
              }
              delete metadata[certificatePath]
            }
          })
        } else {
          artworkURIs(metadata).forEach((artworkUri) => {
            if (path.basename(artworkUri, path.extname(artworkUri)) === artworkNameWithoutExt) {
              const certificateUri = 'file://' + path.resolve(path.dirname(artworkUri).replace('file://', '') +
                  path.sep + artworkNameWithoutExt + path.sep + adjustedCertificatePath)
              if (referencedCertificateUris
                  .map((ref) => _isObject(ref) ? Object.keys(ref)[0] : ref).includes(certificateUri)) {
                metadata[certificateUri] = metadata[certificatePath]
                delete metadata[certificatePath]
              } else {
                if (typeof metadata[artworkUri]['XMP-xmpRights:Certificate'] !== 'undefined') {
                  // Force it to be empty
                  delete metadata[certificatePath]
                  delete metadata[artworkUri]['XMP-xmpRights:Certificate']
                } else {
                  if (forceEmptyIfNotPresentLocally) {
                    // Force it to be empty
                    delete metadata[certificatePath]
                    delete metadata[artworkUri]['XMP-xmpRights:Certificate']
                  } else {
                    // Fix the reference
                    metadata[artworkUri]['XMP-xmpRights:Certificate'] = certificateUri
                    metadata[certificateUri] = metadata[certificatePath]
                    referencedCertificateUris.push(certificateUri)
                    delete metadata[certificatePath]
                  }
                }
              }
            }
          })
        }
      }
    }
  })

  // Now we have the same URI in XMP-xmpRights:Certificate and in the toml table header
  // It may happen that the fields for certificate are passed inline or inside the separate table, we have to align for that

  // Add default certificate if it's not defined elsewhere
  artworksNotReferencingCertificateUris.forEach((uri) => {
    if (!metadata[uri]['XMP-xmpRights:Certificate']) {
      const artworkNameWithoutExt = path.basename(uri, path.extname(uri))
      let defaultCertificateUri =
          `${path.dirname(uri)}/${artworkNameWithoutExt}/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`
      if (globalCertificatePath) {
        if (path.isAbsolute(globalCertificatePath)) {
          defaultCertificateUri = `file://${globalCertificatePath}`
        } else {
          defaultCertificateUri = `file://${path.resolve(path.dirname(uri).replace('file://', '') +
              path.sep +
              artworkNameWithoutExt +
              path.sep +
              globalCertificatePath)}`
        }
        if (globalCertificatePathIsInlineTable) {
          defaultCertificateUri = {
            [defaultCertificateUri]:
                metadata['XMP-xmpRights:Certificate'][Object.keys(metadata['XMP-xmpRights:Certificate'])[0]]
          }
        }
      }

      if (!forceEmptyIfNotPresentLocally) {
        metadata[uri]['XMP-xmpRights:Certificate'] = defaultCertificateUri
        referencedCertificateUris.push(metadata[uri]['XMP-xmpRights:Certificate'])
      } else {
        // Force it to be empty
      }
    }
  })

  // Make sure that for every referenced certificate has a toml table
  referencedCertificateUris.forEach((certificateUri) => {
    const certificateUriIsInlineTable = (typeof certificateUri === 'object' &&
        certificateUri !== null &&
        !Array.isArray(certificateUri))

    if (certificateUriIsInlineTable) {
      certificateUri = Object.keys(certificateUri)[0]
    }

    if (!Object.keys(metadata).includes(certificateUri)) {
      metadata[certificateUri] = {}
    }
  })

  // Everything that's specified inline will be overwritten by the specific toml table.
  // NOTE: we already have normalized certificate fields by now
  artworkURIs(metadata).forEach((uri) => {
    let referencedCertificateUri = metadata[uri]['XMP-xmpRights:Certificate']
    const certificateUriIsInlineTable = (typeof referencedCertificateUri === 'object' &&
        !Array.isArray(referencedCertificateUri))
    if (!certificateUriIsInlineTable) {
      metadata[uri]['XMP-xmpRights:Certificate'] = {}
      metadata[uri]['XMP-xmpRights:Certificate'][referencedCertificateUri] = {...metadata[referencedCertificateUri]}
    }

    if (typeof referencedCertificateUri === 'undefined') {
      // We will still try to generate it with sensible defaults
      const referencedCertificateUri = `${path.dirname(uri)}/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`
      if (metadata[referencedCertificateUri]) {
        metadata[uri]['XMP-xmpRights:Certificate'] = metadata[referencedCertificateUri]
      } else {
        // Pretend it was prescribed in the toml file, but doesn't have any variables
        metadata[uri]['XMP-xmpRights:Certificate'] = {}
        metadata[uri]['XMP-xmpRights:Certificate'][referencedCertificateUri] = {}
      }
    } else {
      if (!referencedCertificateUri) {
        // Forced to be empty
        delete metadata[`${path.dirname(uri)}/${CERTIFICATE_FILE_NAME_WITHOUT_EXT}.pdf`]
      } else {
        if (certificateUriIsInlineTable) {
          referencedCertificateUri = Object.keys(referencedCertificateUri)[0]
        }
        // Merge both ways
        metadata[uri]['XMP-xmpRights:Certificate'][referencedCertificateUri] = {
          ...metadata[uri]['XMP-xmpRights:Certificate'][referencedCertificateUri],
          ...metadata[referencedCertificateUri]
        }

        metadata[referencedCertificateUri] = {
          ...metadata[uri]['XMP-xmpRights:Certificate'][referencedCertificateUri],
          ...metadata[referencedCertificateUri]
        }
      }
    }
  })

  // Now we should have the certificates (or forced absence of it) in the context of every artwork
  // As the variables have been merged as well, we can get rid of the global certificate definition for cleanness
  referencedCertificateUris.forEach((certificateUri) => {
    certificateUri = !_isObject(certificateUri) ? certificateUri : Object.keys(certificateUri)[0]
    delete metadata[certificateUri]
  })


  // For every certificate that we have, we need to add default values
  // NOTE: that all the fields have already been normalized
  artworkURIs(metadata).forEach((artworkUri) => {
    const certificateMeta = Object.values(metadata[artworkUri]['XMP-xmpRights:Certificate'])[0]
    CERTIFICATE_SUPPORTED_INFO_TAGS.forEach((tag) => {
      // Prefer more specific declaration
      if (`XMP-pdf:${tag}` in certificateMeta) {
        certificateMeta[tag] = certificateMeta[`XMP-pdf:${tag}`]
        delete certificateMeta[`XMP-pdf:${tag}`]
      }
    })

    // Fallback to defaults
    CERTIFICATE_SUPPORTED_INFO_TAGS.forEach((tag) => {
      if (!(tag in certificateMeta)) {
        switch (tag) {
          case 'Author':
            if (metadata[artworkUri]['XMP-dc:Creator']) {
              certificateMeta[tag] = metadata[artworkUri]['XMP-dc:Creator']
            }
            break
          case 'Title':
            certificateMeta[tag] = 'Certificate of Authenticity'
            break
        }
      }
    })
  })

  // It's safe to clean it up from the metadata, as we have what we need from the global certificate info
  delete metadata['XMP-xmpRights:Certificate']
}

/**
 * Normalizes the field names in the certificate metadata. Such things like "author" will become "Title" and so on.
 *
 * @param {Object} certificateMetadata
 * @private
 */
function _normalizeCertificateFieldNames(certificateMetadata) {
  if (certificateMetadata && _isObject(certificateMetadata) && Object.keys(certificateMetadata).length !== 0) {
    const inlineTable = certificateMetadata[Object.keys(certificateMetadata)[0]]
    const renamingMap = {}

    Object.keys(inlineTable).forEach((key) => {
      const keyCapitalized = key.charAt(0).toUpperCase() + key.toLowerCase().slice(1)
      if (CERTIFICATE_SUPPORTED_INFO_TAGS.includes(keyCapitalized)) {
        renamingMap[key] = keyCapitalized
      } else {
        if (key.toLowerCase().startsWith('xmp-pdf:')) {
          let realKeyName = key.split(':')
          realKeyName.shift()
          realKeyName = realKeyName.join(':')
          renamingMap[key] = `XMP-pdf:${realKeyName.charAt(0).toUpperCase() + realKeyName.toLowerCase().slice(1)}`
        } else {
          // We're dealing with variables not info tags, those we always lowercase
          renamingMap[key] = key.toLowerCase()
        }
      }
    })

    Object.keys(renamingMap).forEach((key) => {
      if (key !== renamingMap[key]) {
        inlineTable[renamingMap[key]] = inlineTable[key]
        delete inlineTable[key]
      }
    })
  } else {
    // Nothing to normalize, it's not an inline table
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
