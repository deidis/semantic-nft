const assert = require('assert')
describe('ExifTool version', function() {
  const ExifTool = require('exiftool-vendored').ExifTool
  const exiftool = new ExifTool({taskTimeoutMillis: 5000})
  const expectedVersion = '12.70'

  it(`should be ${expectedVersion} or later`, async function() {
    const version = await exiftool.version()
    assert.equal(parseFloat(version) >= parseFloat(expectedVersion), true)
  })

  after(function() {
    exiftool.end()
  })
})

describe('TOML vocabulary', function() {
  const TOML = require('@iarna/toml')
  const tomlFile = require('fs').readFileSync('nft-workspace/example-project/art-metadata.toml', 'utf8')
  const exampleProjectDescriptor = TOML.parse(tomlFile)
  console.log(exampleProjectDescriptor)
})
