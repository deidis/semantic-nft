import _ from 'lodash'

/**
 * IMPORTANT: ordering here matters, as we want to resolve XMP-dc, XMP-xmpRights, Exif, nft, schema in that order.
 * Luckily at the moment of writing this, we have only nft:name and schema:name that can conflict (which is fine).
 * @type {string[][]}
 */
const synonyms = [
  ['XMP-dc:Contributor', 'schema:contributor'],
  ['XMP-dc:Coverage',],
  ['XMP-dc:Creator', 'Exif:Artist', 'schema:creator'],
  ['XMP-dc:Date', 'schema:datePublished'],
  ['XMP-dc:Description', 'nft:description', 'schema:description'],
  ['XMP-dc:Format', 'schema:encodingFormat',],
  ['XMP-dc:Identifier', 'schema:@id'],
  ['XMP-dc:Language',],
  ['XMP-dc:Publisher', 'schema:publisher'],
  ['XMP-dc:Relation',],
  ['XMP-dc:Rights',],
  ['XMP-dc:Source',],
  ['XMP-dc:Subject',],
  ['XMP-dc:Title', 'nft:name', 'schema:name', 'Exif:ImageDescription'],
  ['XMP-dc:Type', 'schema:@type'],
  // Doesn't have synonyms, and it's safe to update this field directly without updateObjectFieldWithAllSynonyms()
  ['XMP-xmpRights:Certificate',],
  ['XMP-xmpRights:Marked',],
  ['XMP-xmpRights:UsageTerms',],
  ['XMP-xmpRights:WebStatement', 'schema:license',],
  ['Exif:Copyright',],
  ['Exif:DateTimeDigitized',], // UTC
  ['Exif:DateTimeOriginal', 'Exif:CreateDate', 'schema:dateCreated'], // UTC
  ['Exif:DateTime', 'Exif:ModifyDate', 'schema:dateModified',], // UTC
  ['nft:image', 'schema:image', 'nft:image_url',],
  ['nft:image_details',],
  ['nft:external_url', 'schema:url',],
  ['nft:attributes',],
  ['nft:properties',],
  ['schema:additionalProperty',],
  ['schema:associatedMedia',],
  ['schema:@context',],
  ['schema:copyrightHolder',],
  ['schema:copyrightYear',],
  ['schema:sameAs',],
  ['schema:version',],
]

/**
 * @param {string} field
 * @param {*} value
 * @param {boolean} best
 * @return {string}
 */
export function lookupQualifiedName(field, value = null, best = true) {
  let result = null
  synonyms.flat(2).forEach((synonym) => {
    if (!result) {
      if (synonym.toLowerCase() === field.toLowerCase()) {
        result = best ? _best(synonym, value): synonym
      } else {
        const parts = synonym.split(':')
        if (parts.length === 2 && parts[1].toLowerCase() === field.toLowerCase()) {
          result = best || _.isObjectLike(value) ? _best(synonym, value): synonym
        }
      }
    }
  })
  return result
}

/**
 * @param {string} qualifiedName
 * @return {string[]}
 */
export function lookupSynonyms(qualifiedName) {
  const result = []
  synonyms.forEach((synonymList) => {
    if (synonymList.includes(qualifiedName)) {
      result.push(...synonymList)
    }
  })
  return result
}

/**
 * @param {object} object
 * @param {string} field
 * @param {*} value
 * @param {boolean} overwriteSynonyms
 */
export function updateObjectFieldWithAllSynonyms(object, field, value, overwriteSynonyms = true) {
  const qualifiedName = lookupQualifiedName(field, value, false)
  if (qualifiedName) {
    const synonyms = lookupSynonyms(qualifiedName)
    if (!value) {
      synonyms.forEach((synonym) => {
        if (qualifiedName === synonym || overwriteSynonyms) {
          delete object[synonym]
        }
      })
    } else {
      if (_.intersection(
          synonyms,
          ['XMP-dc:Contributor', 'XMP-dc:Creator', 'XMP-dc:Publisher', 'XMP-xmpRights:Owner']).length > 0) {
        _specialUpdateStructScalar(object, qualifiedName, value, overwriteSynonyms)
      } if (_.intersection(
          synonyms,
          ['XMP-dc:Type']).length > 0) {
        _specialUpdateType(object, qualifiedName, value, overwriteSynonyms)
      } else {
        synonyms.forEach((synonym) => {
          if (qualifiedName === synonym || overwriteSynonyms) {
            object[synonym] = value
          } else if (object[synonym] === undefined) {
            object[synonym] = value
          } else {
            // Do nothing
          }
        })
      }
    }
  }
}

/**
 * @param {object} object
 * @param {string} field
 */
export function deleteObjectFieldWithAllSynonyms(object, field) {
  const qualifiedName = lookupQualifiedName(field, null, false)
  if (qualifiedName) {
    const synonyms = lookupSynonyms(qualifiedName)
    synonyms.forEach((synonym) => {
      delete object[synonym]
    })
  }
}

const _best = (qualifiedKey, value) => {
  for (const synonymList of synonyms) {
    if (synonymList.includes(qualifiedKey)) {
      if (!value) {
        return synonymList[0]
      } else if (_.isString(value)) {
        return synonymList[0]
      } else if (_.isObjectLike(value)) {
        let bestMatch = synonymList[0]
        for (const synonym of synonymList) {
          if (synonym.startsWith('schema:')) {
            bestMatch = synonym
            break
          }
        }
        return bestMatch
      } else {
        return synonymList[0]
      }
    }
  }
}

/**
 * @param {object} object
 * @param {string} qualifiedKeyName
 * @param {*} value
 * @param {boolean} overwriteSynonyms
 * @private
 */
function _specialUpdateType(object, qualifiedKeyName, value, overwriteSynonyms) {
  let dcType
  let schemaType
  // TODO: (phase 2) we have to map the XMP-dc:Type and schema:@type better, now it's only Image/Photograph
  if (qualifiedKeyName === 'XMP-dc:Type') {
    dcType = value
    if (dcType !== 'Image') {
      schemaType = 'CreativeWork'
    } else {
      schemaType = 'Photograph'
    }
  } else {
    schemaType = value
    if (schemaType === 'Photograph') {
      dcType = 'Image'
    } else {
      dcType = ''
    }
  }

  if (overwriteSynonyms) {
    object['XMP-dc:Type'] = dcType
    object['schema:@type'] = schemaType
  } else {
    object['XMP-dc:Type'] = object['XMP-dc:Type'] ?? dcType
    object['schema:@type'] = object['schema:@type'] ?? schemaType
  }
}

/**
 * @param {object} object
 * @param {string} qualifiedKeyName
 * @param {*} value
 * @param {boolean} overwriteSynonyms
 * @private
 */
function _specialUpdateStructScalar(object, qualifiedKeyName, value, overwriteSynonyms) {
  let scalarVal
  let shortVal
  let structVal
  if (_.isString(value)) {
    scalarVal = value
    structVal = []
    value.split(',').forEach((name) => {
      structVal.push({
        '@type': 'Person', // Assume person...
        'name': name.trim(),
      })
    })
    shortVal = structVal[0].name
  } else if (_.isArray(value) && value.length > 0) {
    const isArrayOfObjects = _.isObjectLike(value[0])
    if (isArrayOfObjects) {
      // Assume schema.org format
      structVal = value
      scalarVal = value.map((obj) => obj.name).join(', ')
      shortVal = structVal[0].name
    } else {
      structVal = []
      value.forEach((name) => {
        structVal.push({
          '@type': 'Person', // Assume person...
          'name': name.trim(),
        })
      })
      scalarVal = value.join(', ')
      shortVal = structVal[0].name
    }
  } else if (_.isObjectLike(value)) {
    // Assume schema.org format
    structVal = value
    scalarVal = shortVal = value.name
  } else {
    // Unrecognized value, skip
  }

  if (scalarVal && structVal || scalarVal && structVal && shortVal) {
    if (structVal.length === 1) {
      structVal = structVal[0]
    }

    const synonyms = lookupSynonyms(qualifiedKeyName)
    if (synonyms.includes('XMP-dc:Creator')) {
      if (overwriteSynonyms) {
        object['XMP-dc:Creator'] = scalarVal
        object['schema:creator'] = structVal
        object['Exif:Artist'] = shortVal
      } else {
        object['XMP-dc:Creator'] = object['XMP-dc:Creator'] ?? scalarVal
        object['schema:creator'] = object['schema:creator'] ?? structVal
        object['Exif:Artist'] = object['Exif:Artist'] ?? shortVal
      }
    } else if (synonyms.includes('XMP-dc:Contributor')) {
      if (overwriteSynonyms) {
        object['XMP-dc:Contributor'] = scalarVal
        object['schema:contributor'] = structVal
      } else {
        object['XMP-dc:Contributor'] = object['XMP-dc:Contributor'] ?? scalarVal
        object['schema:contributor'] = object['schema:contributor'] ?? structVal
      }
    } else if (synonyms.includes('XMP-dc:Publisher')) {
      if (overwriteSynonyms) {
        object['XMP-dc:Publisher'] = scalarVal
        object['schema:publisher'] = structVal
      } else {
        object['XMP-dc:Publisher'] = object['XMP-dc:Publisher'] ?? scalarVal
        object['schema:publisher'] = object['schema:publisher'] ?? structVal
      }
    } else if (synonyms.includes('XMP-xmpRights:Owner')) {
      if (overwriteSynonyms) {
        object['XMP-xmpRights:Owner'] = scalarVal
        object['schema:copyrightHolder'] = structVal
      } else {
        object['XMP-xmpRights:Owner'] = object['XMP-xmpRights:Owner'] ?? scalarVal
        object['schema:copyrightHolder'] = object['schema:copyrightHolder'] ?? structVal
      }
    }
  }
}
