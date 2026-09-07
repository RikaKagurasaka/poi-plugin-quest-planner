'use strict'

const fs = require('fs')
const path = require('path')
const { coverage, validateData } = require('./schema-v4')

const flagIndex = process.argv.indexOf('--data')
const file = path.resolve(flagIndex >= 0 ? process.argv[flagIndex + 1] : path.join(__dirname, '..', 'data', 'quests.json'))
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const errors = validateData(data)
console.log(JSON.stringify(coverage(data, errors), null, 2))
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
