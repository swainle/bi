import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM output
  {
    entry: {
      index: 'src/index.ts',
      'core/index': 'src/core/index.ts',
      'hooks/index': 'src/hooks/index.ts',
      'components/index': 'src/components/index.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    splitting: false,
    external: ['react', 'react-dom'],
  },
  // CJS output
  {
    entry: {
      index: 'src/index.ts',
      'core/index': 'src/core/index.ts',
      'hooks/index': 'src/hooks/index.ts',
      'components/index': 'src/components/index.ts',
    },
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: true,
    treeshake: true,
    splitting: false,
    external: ['react', 'react-dom'],
  },
]);
