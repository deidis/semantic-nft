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
  ['XMP-dc:Format',],
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
  ['XMP-xmpRights:Owner', 'schema:copyrightHolder',],
  ['XMP-xmpRights:UsageTerms', 'schema:usageInfo',],
  ['XMP-xmpRights:WebStatement', 'schema:license',],
  ['Exif:Copyright',],
  ['Exif:DateTimeDigitized', 'Exif:CreateDate', 'schema:dateCreated',], // UTC
  ['Exif:DateTimeOriginal',], // UTC
  ['Exif:DateTime', 'Exif:ModifyDate', 'schema:dateModified',], // UTC
  ['nft:image', 'schema:image', 'nft:image_url',],
  ['nft:image_details',],
  ['nft:external_url', 'schema:url',],
  ['nft:attributes',],
  ['nft:properties',],
  ['schema:additionalProperty',],
  ['schema:associatedMedia',],
  ['schema:@context',],
  ['schema:copyrightYear',],
  ['schema:encodingFormat',],
  ['schema:sameAs',],
  ['schema:version',],
]

/**
 * @param {string} field
 * @param {boolean} best
 * @return {string}
 */
export function lookupQualifiedName(field, best = true) {
  let result = null
  synonyms.flat(2).forEach((synonym) => {
    if (!result) {
      if (synonym.toLowerCase() === field.toLowerCase()) {
        result = best ? _best(synonym): synonym
      } else {
        const parts = synonym.split(':')
        if (parts.length === 2 && parts[1].toLowerCase() === field.toLowerCase()) {
          result = best ? _best(synonym): synonym
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
 * @param {string} value
 */
export function updateObjectFieldWithAllSynonyms(object, field, value) {
  const qualifiedName = lookupQualifiedName(field, false)
  if (qualifiedName) {
    const synonyms = lookupSynonyms(qualifiedName)
    synonyms.forEach((synonym) => {
      object[synonym] = value
    })
  }
}

/**
 * @param {object} object
 * @param {string} field
 */
export function deleteObjectFieldWithAllSynonyms(object, field) {
  const qualifiedName = lookupQualifiedName(field, false)
  if (qualifiedName) {
    const synonyms = lookupSynonyms(qualifiedName)
    synonyms.forEach((synonym) => {
      delete object[synonym]
    })
  }
}

const _best = (qualifiedKey) => {
  for (const synonymList of synonyms) {
    if (synonymList.includes(qualifiedKey)) {
      return synonymList[0]
    }
  }
}
