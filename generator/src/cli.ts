import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadGeneratorConfig } from './config.ts';
import { generateAll } from './generate.ts';
import type { BuiltChallenge } from './types.ts';

interface CliOptions {
  config?: string;
  out?: string;
  only?: string;
  verify?: boolean;
  write?: boolean;
}

function printChallenge(built: BuiltChallenge): void {
  const status = built.validation ? (built.validation.ok ? 'PASS' : 'FAIL') : 'SKIP';
  console.log(`  ${built.id} [${built.classification}] ${status} challengeVersion=${built.manifest.challengeVersion} contentHash=${built.contentHash.slice(0, 12)}`);
  if (built.classification !== 'unsupported') {
    const removedHelpers = built.transformReport.removedHelpers.join(', ');
    const removedImports = built.transformReport.removedImports.join(', ');
    if (removedHelpers) {
      console.log(`    removed helpers : ${removedHelpers}`);
    }
    if (removedImports) {
      console.log(`    removed imports : ${removedImports}`);
    }
    if (built.validation) {
      for (const check of built.validation.checks) {
        console.log(`    ${check.passed ? 'ok  ' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
      }
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  const hasNoVerify = argv.includes('--no-verify');
  const hasNoWrite = argv.includes('--no-write');
  const cleanArgv = argv.filter((arg) => arg !== '--no-verify' && arg !== '--no-write');
  const { values } = parseArgs({
    args: cleanArgv,
    options: {
      config: { type: 'string' },
      out: { type: 'string' },
      only: { type: 'string' },
      verify: { type: 'boolean', default: true },
    },
  });

  const cli: CliOptions = {
    config: values.config,
    out: values.out,
    only: values.only,
    verify: hasNoVerify ? false : values.verify,
    write: hasNoWrite ? false : true,
  };

  const configFile = loadGeneratorConfig(cli.config);
  const only = cli.only ? new Set(cli.only.split(',')) : null;
  const challenges = only ? configFile.challenges.filter((c) => only.has(c.id)) : configFile.challenges;
  const filteredConfig = { ...configFile, challenges };

  const report = await generateAll(filteredConfig, {
    verify: cli.verify,
    write: cli.write,
    outputDir: cli.out,
    writeAggregates: only == null,
  });

  console.log(`\nChallenge Generator v${configFile.generatorVersion} (upstream ${configFile.upstream.repository}@${configFile.upstream.commit.slice(0, 12)})`);
  console.log(`output: ${report.outputDir}`);
  console.log('');

  for (const built of report.built) {
    printChallenge(built);
  }

  if (report.unsupported.length > 0) {
    console.log('\nUnsupported challenges:');
    for (const entry of report.unsupported) {
      console.log(`  ${entry.id}: ${entry.reasons.join('; ')}`);
    }
  }

  if (cli.verify !== false) {
    const failed = report.built.filter((b) => b.classification !== 'unsupported' && b.validation && !b.validation.ok);
    const unsupportedCount = report.built.filter((b) => b.classification === 'unsupported').length;
    console.log(`\nsummary: ${report.built.length} challenge(s), ${unsupportedCount} unsupported, ${failed.length} validation failure(s)`);
    return failed.length > 0 ? 1 : 0;
  }

  console.log('\nsummary: verification skipped');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
