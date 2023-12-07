import path from 'path'
import fs from 'fs'
import TOML from '@iarna/toml'
import {collectFiles} from './collectFiles.js'
import {exiftool} from 'exiftool-vendored'

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
  const metadata = getMetadata(tomlFilePaths)
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
function getMetadata(tomlFileAbsolutePaths) {
  if (typeof tomlFileAbsolutePaths === 'undefined' || tomlFileAbsolutePaths === null) {
    if (Object.keys(__METADATA_CACHE).length === 0) {
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

  // TODO: recognize the keys in metadata and convert them into tags

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
        let artworkFilePaths = collectFiles(searchPath, 0)
        if (!fileNameGivenWithExtension) {
          artworkFilePaths = artworkFilePaths.filter((filePath) => {
            return path.basename(filePath).
                startsWith(path.basename(artworkPathWithoutWildcard))
          })
        }
        result[artworkTomlHeader] = artworkFilePaths
      }

      if (result[artworkTomlHeader].length === 0) {
        delete result[artworkTomlHeader]
      }
    }
  }

  return result
}

const commonMetadataForAllArtworks = (metadata) => {
  const tomlJson = metadata || getMetadata()
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
  return Object.keys(metadata || getMetadata()).filter((key) => {
    return key.startsWith('file:///')
  })
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
