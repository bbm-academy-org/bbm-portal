import { extname, isAbsolute, relative } from 'node:path'

// An object config runs overlapping glob tasks concurrently. One function keeps
// eslint/stylelint ahead of Prettier while the exported globs remain comparable
// to format:check, so an installed hook needs no command-line concurrency flag.
const formatDirectories = ['src', 'tools', 'docs', 'deploy', 'tests', '.claude']
const formatExtensions = ['ts', 'tsx', 'css', 'md', 'json', 'yml', 'yaml']
const workflowExtensions = ['yml', 'yaml']
const rootExtensions = ['md', 'json']
const stylelintDirectory = 'src'

export const prettierGlobs = [
  ...formatDirectories.map(
    (directory) => `${directory}/**/*.{${formatExtensions.join(',')}}`,
  ),
  `.github/**/*.{${workflowExtensions.join(',')}}`,
  ...rootExtensions.map((extension) => `./*.${extension}`),
]
export const stylelintGlob = `${stylelintDirectory}/**/*.css`

const formatDirectorySet = new Set(formatDirectories)
const formatExtensionSet = new Set(formatExtensions.map((extension) => `.${extension}`))
const workflowExtensionSet = new Set(workflowExtensions.map((extension) => `.${extension}`))
const rootExtensionSet = new Set(rootExtensions.map((extension) => `.${extension}`))

const relativePath = (cwd, filepath) => relative(cwd, filepath).replaceAll('\\', '/')

const isInside = (path) => path !== '' && !path.startsWith('../') && !isAbsolute(path)

export const isPrettierPath = (cwd, filepath) => {
  const path = relativePath(cwd, filepath)
  if (!isInside(path)) return false

  const extension = extname(path)
  const segments = path.split('/')
  if (segments.length === 1) return rootExtensionSet.has(extension)
  if (segments[0] === '.github') return workflowExtensionSet.has(extension)
  return formatDirectorySet.has(segments[0]) && formatExtensionSet.has(extension)
}

const isStylelintPath = (cwd, filepath) => {
  const path = relativePath(cwd, filepath)
  return isInside(path) && path.startsWith(`${stylelintDirectory}/`) && extname(path) === '.css'
}

const quote = (filepath) => `"${filepath.replaceAll('"', '\\"')}"`

const command = (executable, files) =>
  files.length === 0 ? [] : [`${executable} ${files.map(quote).join(' ')}`]

export const createLintStagedConfig = (cwd = import.meta.dirname) => (files) => {
  const eslintFiles = files.filter((file) => /\.tsx?$/.test(file))
  const stylelintFiles = files.filter((file) => isStylelintPath(cwd, file))
  const prettierFiles = files.filter((file) => isPrettierPath(cwd, file))

  return [
    ...command('eslint --fix', eslintFiles),
    ...command('stylelint --fix', stylelintFiles),
    ...command('prettier --write', prettierFiles),
  ]
}

export default createLintStagedConfig()
