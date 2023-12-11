import path from 'path'
import fs from 'fs'
import TOML from '@iarna/toml'
import {collectFiles, SUPPORTED_IMAGE_FILE_TYPES} from './collectFiles.js'
import {exiftool} from 'exiftool-vendored'
import {
  ARTWORK_FILE_NAME_WITHOUT_EXT,
  ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT,
} from './artwork.js'
import {CERTIFICATE_FILE_NAME_WITHOUT_EXT} from './certificate.js'

const __METADATA_CACHE = {}
const __CACHE_KEY = (tomlFileAbsolutePaths) => {
  return tomlFileAbsolutePaths.sort().join('|')
}

/**
 * Ingests the given TOML files into images
 * @param {string[]|undefined|null} metadata - Absolute paths to the TOML files
 * @return {Promise<void>}
 */
export function ingest(metadata) {
  metadata = metadata || _getMetadata()
  // console.debug(JSON.stringify(metadata, null, 2))
  const commonMetadata = commonMetadataForAllArtworks(metadata)
  const ingestingPromises = []
  artworkURIs().forEach((artworkURI) => {
    ingestingPromises.push(_ingestMetadataForSpecificArtwork(artworkURI, commonMetadata).then(() => {
      return _ingestMetadataForSpecificArtwork(artworkURI, metadata[artworkURI]).then(() => {
        console.log(`Ingested metadata into ${artworkURI}`)
      })
    }).catch((err) => {
      console.error(`Failed to ingest metadata into ${artworkURI}: ${err}`)
    }))
  })
  return Promise.all(ingestingPromises)
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
 * @param {string} artworkPath
 * @param {object} tags
 * @return {Promise<void>}
 * @private
 */
function _ingestMetadataForSpecificArtwork(artworkPath, tags) {
  artworkPath = artworkPath.replace('file://', '')
  return exiftool.write(artworkPath, tags, ['-xmptoolkit=', '-overwrite_original'])
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

  _normalizeFieldNames(result)

  _prepareMetadataOfCertificates(result)

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
    if (!(typeof tomlJson[tomlJsonKey] === 'object' &&
        tomlJson[tomlJsonKey] !== null &&
        !Array.isArray(tomlJson[tomlJsonKey]))) {
      result[tomlJsonKey] = tomlJson[tomlJsonKey]
    }
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
          if (path.dirname(path.basename(uriToCheck)) === path.dirname(path.basename(previewUri))) {
            return previewUri.startsWith(`${path.dirname(uriToCheck)}}`)
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
  const filtered = Object.keys(metadata || _getMetadata()).filter((key) => {
    return key.startsWith(`file://${path.dirname(artworkAbsolutePathOrUri)}`+
        `/${path.basename(artworkAbsolutePathOrUri, path.extname(artworkAbsolutePathOrUri))}`+
        `/${ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT}`)
  })

  if (filtered.length === 1) {
    return path.extname(filtered[0])
  } else {
    return path.extname(artworkAbsolutePathOrUri)
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
 *
 * @param {Object} metadata
 * @private
 */
function _normalizeFieldNames(metadata) {
  // console.log(metadata)
  // TODO: recognize the keys in metadata and convert them into tags
  // TODO: recognize the vocabulary inside certificate tags as well!!!

  // Normalize the "certificate"
  Object.keys(metadata).filter((key) => {
    return key.toLowerCase() === 'certificate' || key.toLowerCase() === 'xmp-xmprights:certificate'
  }).forEach((key) => {
    metadata['XMP-xmpRights:Certificate'] = metadata[key]
    delete metadata[key]
  })
  artworkURIs(metadata).forEach((artworkURI) => {
    Object.keys(metadata[artworkURI]).filter((key) => {
      return key.toLowerCase() === 'certificate' || key.toLowerCase() === 'xmp-xmprights:certificate'
    }).forEach((key) => {
      metadata[artworkURI]['XMP-xmpRights:Certificate'] = metadata[artworkURI][key]
      delete metadata[artworkURI][key]
    })
  })

  // TODO: resolve the variables
}

/**
 * Adjusts the metadata related certificates
 * @param {object} metadata
 * @private
 */
function _prepareMetadataOfCertificates(metadata) {
  // collect referenced certificate, turn them into URIs beforehand
  const referencedCertificateUris = artworkURIs(metadata).map((uri) => {
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
      metadata[uri]['XMP-xmpRights:Certificate'] = `file://${certificatePath}`
    }

    return metadata[uri]['XMP-xmpRights:Certificate']
  }).filter((mappedCertificateUri) => !!mappedCertificateUri)

  // Adjust the toml table headers that represent certificates
  Object.keys(metadata).filter((key) => {
    return !key.startsWith('file://') && key.endsWith(`.pdf`)
  }).forEach((certificatePath) => {
    if (path.isAbsolute(certificatePath)) {
      if (referencedCertificateUris.includes(`file://${certificatePath}`)) {
        metadata[`file://${certificatePath}`] = metadata[certificatePath]
        delete metadata[certificatePath]
      } else {
        console.warn(`Certificate ${certificatePath} is not referenced by any artwork.`)
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
              if (path.basename(specificCertificateUri) === path.basename(adjustedCertificatePath)) {
                metadata[specificCertificateUri] = metadata[certificatePath]
                delete metadata[certificatePath]
              }
            }
          })
        } else {
          artworkURIs(metadata).forEach((uri) => {
            if (path.basename(uri, path.extname(uri)) === artworkNameWithoutExt) {
              adjustedCertificatePath = path.dirname(uri).replace('file://', '') +
                  path.sep + artworkNameWithoutExt + path.sep + adjustedCertificatePath
              if (referencedCertificateUris.includes(`file://${path.resolve(adjustedCertificatePath)}`)) {
                metadata[`file://${path.resolve(adjustedCertificatePath)}`] = metadata[certificatePath]
                delete metadata[certificatePath]
              } else {
                console.warn(`Certificate ${adjustedCertificatePath} is not referenced by any artwork.`)
              }
            }
          })
        }
      }
    }
  })

  // Now we have the same URI in XMP-xmpRights:Certificate and in the toml table header
  // It may happen that the fields for certificate are passed inline or inside the separate table, we have to align for that

  // First make sure that for every referenced certificate we have a toml table
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

  // Everything that's specified inline will be overwritten by the specific toml table
  artworkURIs(metadata).forEach((uri) => {
    let certificateUri = metadata[uri]['XMP-xmpRights:Certificate']
    if (certificateUri) {
      const certificateUriIsInlineTable = (typeof certificateUri === 'object' &&
          !Array.isArray(certificateUri))
      if (!certificateUriIsInlineTable) {
        metadata[uri]['XMP-xmpRights:Certificate'] = {}
        metadata[uri]['XMP-xmpRights:Certificate'][certificateUri] = {...metadata[certificateUri]}
      } else {
        certificateUri = Object.keys(certificateUri)[0]
        // Merge both ways
        metadata[uri]['XMP-xmpRights:Certificate'][certificateUri] = {
          ...metadata[uri]['XMP-xmpRights:Certificate'][certificateUri],
          ...metadata[certificateUri]
        }

        metadata[certificateUri] = {
          ...metadata[uri]['XMP-xmpRights:Certificate'][certificateUri],
          ...metadata[certificateUri]
        }
      }
    }
  })
}
