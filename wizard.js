const {collect} = require('./src/collect')
const {clean} = require('./src/clean')
const inquirer = require('inquirer')
const args = process.argv.slice(2)

if (args.length === 0) {
  console.log('Please provide a path to the artwork file, multiple files or a directory.')
  process.exit(1)
}


const files = []
args.forEach((arg) => {
  // It's very likely that media files are organized in subfolders,
  // so let's collect them recursively at least one level deep.
  const recursionLevel = 1
  files.push(...collect(arg, recursionLevel))
})

if (files.length > 0) {
  console.log(`Processing ${files.length} files.`)
  files.forEach((file) => {
    console.log(`- ${file}`)
  })

  const exiftool = require('exiftool-vendored').exiftool

  inquirer.prompt([
    {
      type: 'confirm',
      name: 'clean',
      message: 'Do you want to clear all metadata for these files?',
      default: true,
    }
  ]).then((answers) => {
    if (answers.clean) {
      console.log('Clearing metadata...')
      return clean(exiftool, files)
    } else {
      return Promise.resolve()
    }
  }).then(() => {
    console.log('TODO: start ingestion of TOML')
  }).then(() => {
    //
  }).finally(() => {
    exiftool.end(true).finally(() => {
      console.log('Done.')
    })
  })
} else {
  console.log('No files found to process')
}
