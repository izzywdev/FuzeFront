import {
  addProjectConfiguration,
  formatFiles,
  generateFiles,
  Tree,
  names,
  offsetFromRoot,
} from '@nx/devkit';
import * as path from 'path';

interface MicroFrontendGeneratorSchema {
  name: string;
  tags?: string;
  directory?: string;
  port?: number;
}

export default async function (tree: Tree, options: MicroFrontendGeneratorSchema) {
  const normalizedOptions = normalizeOptions(tree, options);
  addProjectConfiguration(tree, normalizedOptions.projectName, {
    root: normalizedOptions.projectRoot,
    projectType: 'application',
    sourceRoot: `${normalizedOptions.projectRoot}/src`,
    targets: {
      build: {
        executor: '@nx/webpack:webpack',
        outputs: ['{options.outputPath}'],
        defaultConfiguration: 'production',
        options: {
          compiler: 'babel',
          outputPath: `dist/${normalizedOptions.projectName}`,
          index: `${normalizedOptions.projectRoot}/index.html`,
          baseHref: '/',
          main: `${normalizedOptions.projectRoot}/src/main.tsx`,
          polyfills: [],
          tsConfig: `${normalizedOptions.projectRoot}/tsconfig.json`,
          assets: [`${normalizedOptions.projectRoot}/public`],
          styles: [`${normalizedOptions.projectRoot}/src/index.css`],
          scripts: [],
          isolatedConfig: true,
          webpackConfig: `${normalizedOptions.projectRoot}/webpack.config.js`,
        },
        configurations: {
          development: {
            extractLicenses: false,
            optimization: false,
            sourceMap: true,
            vendorChunk: true,
          },
          production: {
            fileReplacements: [],
            optimization: true,
            outputHashing: 'all',
            sourceMap: false,
            namedChunks: false,
            extractLicenses: true,
            vendorChunk: false,
          },
        },
      },
      serve: {
        executor: '@nx/webpack:dev-server',
        defaultConfiguration: 'development',
        options: {
          buildTarget: `${normalizedOptions.projectName}:build`,
          hmr: true,
          port: normalizedOptions.port,
        },
        configurations: {
          development: {
            buildTarget: `${normalizedOptions.projectName}:build:development`,
          },
          production: {
            buildTarget: `${normalizedOptions.projectName}:build:production`,
            hmr: false,
          },
        },
      },
      lint: {
        executor: '@nx/eslint:lint',
        outputs: ['{options.outputFile}'],
        options: {
          lintFilePatterns: [`${normalizedOptions.projectRoot}/**/*.{ts,tsx,js,jsx}`],
        },
      },
      test: {
        executor: '@nx/jest:jest',
        outputs: ['{workspaceRoot}/coverage/{projectRoot}'],
        options: {
          jestConfig: `${normalizedOptions.projectRoot}/jest.config.ts`,
          passWithNoTests: true,
        },
        configurations: {
          ci: {
            ci: true,
            coverage: true,
          },
        },
      },
      'type-check': {
        executor: '@nx/js:tsc',
        options: {
          tsConfig: `${normalizedOptions.projectRoot}/tsconfig.json`,
        },
      },
    },
    tags: normalizedOptions.parsedTags,
  });
  
  generateFiles(tree, path.join(__dirname, 'files'), normalizedOptions.projectRoot, {
    ...options,
    ...normalizedOptions,
    offsetFromRoot: offsetFromRoot(normalizedOptions.projectRoot),
    template: '',
  });
  
  await formatFiles(tree);
}

function normalizeOptions(tree: Tree, options: MicroFrontendGeneratorSchema): any {
  const name = names(options.name).fileName;
  const projectDirectory = options.directory ? `${names(options.directory).fileName}/${name}` : name;
  const projectName = projectDirectory.replace(new RegExp('/', 'g'), '-');
  const projectRoot = projectDirectory;
  const parsedTags = options.tags ? options.tags.split(',').map((s) => s.trim()) : ['scope:micro-frontend', 'type:app'];
  const port = options.port || 3000 + Math.floor(Math.random() * 1000);

  return {
    ...options,
    projectName,
    projectRoot,
    projectDirectory,
    parsedTags,
    port,
  };
} 