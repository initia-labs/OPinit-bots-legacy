// rollup.config.js
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
    input: 'src/entrypoint.ts',
    output: {
        dir: 'dist',
        format: 'cjs',
        sourcemap: false,
    },
    plugins: [
        typescript({
            // override tsconfig settings for build only
            compilerOptions: {
                module: "esnext",
                sourceMap: false,
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                esModuleInterop: true,
            }
        }),
        nodeResolve({
            preferBuiltins: true,

            // NOTE: it must be in the order of ['main', 'module'].
            // This is because "module" being in front prevents `koa-swagger-decorator` to be included in the bundle.
            mainFields: ['main', "module"],
            exportConditions: [
                // this is required to resolve typeorm dependencies
                // https://github.com/typeorm/typeorm/blob/e7649d2746f907ff36b1efb600402dedd5f5a499/package.json#L18
                "node",
            ],
        }),
        commonjs(),
        json()
    ]
};