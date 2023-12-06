const {ExifTool} = require('exiftool-vendored')

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
 * @param {ExifTool} exiftool - ExifTool instance
 * @param {string[]} files - List of files for which we want to clean up the metadata
 * @param {boolean} overwrite - Whether to overwrite the original file or not
 * @return {Promise} Promise object represents the result of the operation
 */
function clean(exiftool, files, overwrite = true) {
  const promises = []
  files.forEach((file) => {
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

module.exports = {
  clean
}
