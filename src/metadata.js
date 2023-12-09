import path from 'path'
import fs from 'fs'
import TOML from '@iarna/toml'
import {collectFiles} from './collectFiles.js'
import {exiftool} from 'exiftool-vendored'
import {normalize} from './metadataNormalizer.js'
import {
  ARTWORK_FILE_NAME_WITHOUT_EXT,
  ARTWORK_PREVIEW_FILE_NAME_WITHOUT_EXT,
} from './artwork.js'

const __METADATA_CACHE = {}
const __CACHE_KEY = (tomlFileAbsolutePaths) => {
  return tomlFileAbsolutePaths.sort().join('|')
}

/**
 * Ingests the given TOML files into images
 * @param {string[]|undefined|null} tomlFilePaths - Absolute paths to the TOML files
 * @return {Promise<void>}
 */
export function ingest(tomlFilePaths) {
  const metadata = _getMetadata(tomlFilePaths)
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

  normalize(result)

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
    return key.startsWith('file:///')
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
    return true
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
