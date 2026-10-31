import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import readline from "node:readline";

type ManifestFileEntry = {
  path: string;
  bytes: number;
  sha256: string;
  records: number | null;
};

type RuntimeManifest = {
  package?: string;
  generated_at?: string;
  source_files?: Record<string, string>;
  record_counts?: {
    rag_chunks?: number;
    relations?: number;
    entities?: number;
  };
  schemas?: {
    rag_chunks?: string[];
    relations?: string[];
  };
  files?: ManifestFileEntry[];
};

type VerificationResult = {
  root: string;
  packageName: string;
  generatedAt: string;
  manifest: {
    bytes: number;
    sha256: string;
  };
  files: Array<ManifestFileEntry & { actualRecords: number | null }>;
};

const REQUIRED_RUNTIME_FILES = [
  "runtime/rag_chunks.compact.jsonl.gz",
  "runtime/relations.compact.jsonl.gz",
  "kg/entities.jsonl",
  "kg/kg_stats.json",
  "provenance/README.md",
  "provenance/manifest.json",
  "provenance/file_manifest.jsonl",
] as const;

const REQUIRED_RAG_FIELDS = ["document_title", "source_url", "doi"];
const REQUIRED_RELATION_FIELDS = [
  "evidence_document_title",
  "evidence_source_url",
  "evidence_doi",
];

const RUNTIME_PACKAGE_README = `# CSGPT 运行数据包

\`runtime/rag_chunks.compact.jsonl.gz\` 保存 RAG 检索文本块。
\`runtime/relations.compact.jsonl.gz\` 保存知识图谱关系及其证据来源。
\`kg/entities.jsonl\` 和 \`kg/kg_stats.json\` 保存知识图谱实体与统计信息。
\`provenance/manifest.json\` 和 \`provenance/file_manifest.jsonl\` 保存记录数、字节数和 SHA256。

运行包面向 Web 服务端的文本检索和知识图谱读取，不包含离线向量矩阵、SQLite 检索索引或评测文件。
`;

function printUsage() {
  console.log(`Usage:
  npm run verify:csllm
  npm run sync:csllm -- --source <runtime-package-dir>

Options:
  --source <dir>   Runtime package directory to verify or copy.
  --target <dir>   Target directory inside this repository. Default: data/csllm.
  --verify         Verify only. With --source, verifies the source package.
`);
}

function readArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hasArg(name: string) {
  return process.argv.includes(name);
}

function normalizePackagePath(value: string) {
  return path.resolve(value);
}

function assertTargetInsideRepository(targetRoot: string) {
  const repoRoot = process.cwd();
  const relative = path.relative(repoRoot, targetRoot);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.length === 0
  ) {
    throw new Error(`Target must be inside this repository: ${targetRoot}`);
  }
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(directoryPath: string) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function jsonlReadStream(filePath: string) {
  const stream = createReadStream(filePath);
  return filePath.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

async function countJsonlRecords(filePath: string) {
  const rl = readline.createInterface({
    input: jsonlReadStream(filePath),
    crlfDelay: Infinity,
  });
  let records = 0;
  for await (const line of rl) {
    if (line.trim().length > 0) records += 1;
  }
  return records;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readFileManifest(filePath: string) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ManifestFileEntry);
}

function entryMap(entries: ManifestFileEntry[]) {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function assertSchemaFields(manifest: RuntimeManifest) {
  const ragFields = new Set(manifest.schemas?.rag_chunks || []);
  const relationFields = new Set(manifest.schemas?.relations || []);

  for (const field of REQUIRED_RAG_FIELDS) {
    if (!ragFields.has(field)) {
      throw new Error(`RAG schema is missing required field: ${field}`);
    }
  }
  for (const field of REQUIRED_RELATION_FIELDS) {
    if (!relationFields.has(field)) {
      throw new Error(`Relation schema is missing required field: ${field}`);
    }
  }
}

function assertRecordCounts(
  manifest: RuntimeManifest,
  files: ManifestFileEntry[],
) {
  const byPath = entryMap(files);
  const counts = manifest.record_counts || {};
  const checks: Array<
    [keyof NonNullable<RuntimeManifest["record_counts"]>, string]
  > = [
    ["rag_chunks", "runtime/rag_chunks.compact.jsonl.gz"],
    ["relations", "runtime/relations.compact.jsonl.gz"],
    ["entities", "kg/entities.jsonl"],
  ];

  for (const [key, filePath] of checks) {
    const manifestCount = counts[key];
    const fileCount = byPath.get(filePath)?.records;
    if (typeof manifestCount !== "number" || fileCount !== manifestCount) {
      throw new Error(
        `Record count mismatch for ${filePath}: manifest=${manifestCount}, file=${fileCount}`,
      );
    }
  }
}

async function verifyEntry(
  root: string,
  entry: ManifestFileEntry,
): Promise<ManifestFileEntry & { actualRecords: number | null }> {
  const filePath = path.join(root, entry.path);
  if (!(await fileExists(filePath))) {
    throw new Error(`Required file is missing: ${entry.path}`);
  }

  const stat = await fs.stat(filePath);
  if (stat.size !== entry.bytes) {
    throw new Error(
      `Byte count mismatch for ${entry.path}: expected=${entry.bytes}, actual=${stat.size}`,
    );
  }

  const actualSha256 = await sha256File(filePath);
  if (actualSha256 !== entry.sha256) {
    throw new Error(
      `SHA256 mismatch for ${entry.path}: expected=${entry.sha256}, actual=${actualSha256}`,
    );
  }

  const isJsonl =
    entry.path.endsWith(".jsonl") || entry.path.endsWith(".jsonl.gz");
  const actualRecords =
    typeof entry.records === "number" && isJsonl
      ? await countJsonlRecords(filePath)
      : null;
  if (
    typeof entry.records === "number" &&
    isJsonl &&
    actualRecords !== entry.records
  ) {
    throw new Error(
      `Record count mismatch for ${entry.path}: expected=${entry.records}, actual=${actualRecords}`,
    );
  }

  return { ...entry, actualRecords };
}

async function verifyPackage(root: string): Promise<VerificationResult> {
  if (!(await directoryExists(root))) {
    throw new Error(`Runtime package directory does not exist: ${root}`);
  }

  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    if (!(await fileExists(path.join(root, relativePath)))) {
      throw new Error(`Required runtime file is missing: ${relativePath}`);
    }
  }

  const manifestPath = path.join(root, "provenance/manifest.json");
  const fileManifestPath = path.join(root, "provenance/file_manifest.jsonl");
  const manifest = await readJsonFile<RuntimeManifest>(manifestPath);
  const manifestEntries = manifest.files || [];
  const fileManifestEntries = await readFileManifest(fileManifestPath);
  const manifestByPath = entryMap(manifestEntries);
  const fileManifestByPath = entryMap(fileManifestEntries);

  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    if (relativePath === "provenance/manifest.json") continue;
    if (!manifestByPath.has(relativePath)) {
      throw new Error(`manifest.json is missing file entry: ${relativePath}`);
    }
    if (
      relativePath !== "provenance/file_manifest.jsonl" &&
      !fileManifestByPath.has(relativePath)
    ) {
      throw new Error(
        `file_manifest.jsonl is missing file entry: ${relativePath}`,
      );
    }
  }

  for (const entry of fileManifestEntries) {
    const manifestEntry = manifestByPath.get(entry.path);
    if (!manifestEntry) {
      continue;
    }
    if (
      manifestEntry.bytes !== entry.bytes ||
      manifestEntry.sha256 !== entry.sha256 ||
      manifestEntry.records !== entry.records
    ) {
      throw new Error(`Manifest entries disagree for ${entry.path}`);
    }
  }

  assertSchemaFields(manifest);
  assertRecordCounts(manifest, manifestEntries);

  const verifiedFiles = [];
  for (const entry of manifestEntries) {
    verifiedFiles.push(await verifyEntry(root, entry));
  }

  const manifestStat = await fs.stat(manifestPath);
  return {
    root,
    packageName: manifest.package || "",
    generatedAt: manifest.generated_at || "",
    manifest: {
      bytes: manifestStat.size,
      sha256: await sha256File(manifestPath),
    },
    files: verifiedFiles,
  };
}

async function replaceDirectory(sourceRoot: string, targetRoot: string) {
  const sourceRealPath = await fs.realpath(sourceRoot);
  const targetExists = await directoryExists(targetRoot);
  const targetRealPath = targetExists ? await fs.realpath(targetRoot) : "";
  if (targetRealPath && sourceRealPath === targetRealPath) {
    throw new Error("Source and target runtime directories are the same");
  }

  assertTargetInsideRepository(targetRoot);

  const targetParent = path.dirname(targetRoot);
  const tempRoot = path.join(
    targetParent,
    `.csllm-sync-${Date.now()}-${process.pid}`,
  );

  await fs.rm(tempRoot, { recursive: true, force: true });
  try {
    const sourceManifest = await readJsonFile<RuntimeManifest>(
      path.join(sourceRoot, "provenance/manifest.json"),
    );
    const sourceEntries = entryMap(sourceManifest.files || []);
    const sourceFileManifestEntries = await readFileManifest(
      path.join(sourceRoot, "provenance/file_manifest.jsonl"),
    );
    const sourceFileEntries = entryMap(sourceFileManifestEntries);
    const dataPaths = REQUIRED_RUNTIME_FILES.filter(
      (relativePath) =>
        relativePath !== "provenance/manifest.json" &&
        relativePath !== "provenance/file_manifest.jsonl",
    );

    await fs.mkdir(tempRoot, { recursive: true });
    for (const relativePath of dataPaths) {
      const sourceEntry =
        sourceEntries.get(relativePath) || sourceFileEntries.get(relativePath);
      if (!sourceEntry) {
        throw new Error(
          `Source manifest is missing file entry: ${relativePath}`,
        );
      }
      const sourcePath = path.join(sourceRoot, relativePath);
      const targetPath = path.join(tempRoot, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      if (relativePath === "provenance/README.md") {
        await fs.writeFile(targetPath, RUNTIME_PACKAGE_README, "utf8");
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }

    const filteredEntries = await Promise.all(
      dataPaths.map(async (relativePath) => {
        const entry =
          sourceEntries.get(relativePath) ||
          sourceFileEntries.get(relativePath);
        if (!entry) {
          throw new Error(
            `Source manifest is missing file entry: ${relativePath}`,
          );
        }
        const targetPath = path.join(tempRoot, relativePath);
        const stat = await fs.stat(targetPath);
        return {
          ...entry,
          bytes: stat.size,
          sha256: await sha256File(targetPath),
        };
      }),
    );
    const fileManifestText =
      filteredEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    const fileManifestPath = path.join(
      tempRoot,
      "provenance/file_manifest.jsonl",
    );
    await fs.writeFile(fileManifestPath, fileManifestText, "utf8");
    const fileManifestEntry: ManifestFileEntry = {
      path: "provenance/file_manifest.jsonl",
      bytes: Buffer.byteLength(fileManifestText),
      sha256: createHash("sha256").update(fileManifestText).digest("hex"),
      records: filteredEntries.length,
    };
    const sourceFileKeys = ["rag_chunks", "relations", "entities", "kg_stats"];
    const filteredSourceFiles = Object.fromEntries(
      sourceFileKeys
        .filter((key) => sourceManifest.source_files?.[key])
        .map((key) => [key, sourceManifest.source_files?.[key]]),
    );
    const filteredManifest = {
      ...sourceManifest,
      source_files: filteredSourceFiles,
      schemas: {
        rag_chunks: sourceManifest.schemas?.rag_chunks || [],
        relations: sourceManifest.schemas?.relations || [],
      },
      files: [...filteredEntries, fileManifestEntry],
    };
    await fs.writeFile(
      path.join(tempRoot, "provenance/manifest.json"),
      `${JSON.stringify(filteredManifest, null, 2)}\n`,
      "utf8",
    );
    await verifyPackage(tempRoot);
    await fs.rm(targetRoot, { recursive: true, force: true });
    await fs.rename(tempRoot, targetRoot);
  } catch (error) {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

function printVerification(result: VerificationResult) {
  console.log(
    JSON.stringify(
      {
        root: result.root,
        package: result.packageName,
        generatedAt: result.generatedAt,
        manifest: result.manifest,
        files: result.files.map((file) => ({
          path: file.path,
          bytes: file.bytes,
          sha256: file.sha256,
          records: file.records,
          actualRecords: file.actualRecords,
        })),
      },
      null,
      2,
    ),
  );
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    printUsage();
    return;
  }

  const sourceArg =
    readArg("--source") || process.env.CSGPT_CSLLM_RUNTIME_SOURCE;
  const targetArg = readArg("--target");
  const targetRoot = normalizePackagePath(
    targetArg || path.join(process.cwd(), "data/csllm"),
  );
  const verifyOnly = hasArg("--verify");

  if (sourceArg) {
    const sourceRoot = normalizePackagePath(sourceArg);
    const sourceResult = await verifyPackage(sourceRoot);
    if (verifyOnly) {
      printVerification(sourceResult);
      return;
    }

    await replaceDirectory(sourceRoot, targetRoot);
    const targetResult = await verifyPackage(targetRoot);
    printVerification(targetResult);
    return;
  }

  if (!verifyOnly) {
    throw new Error(
      "Missing runtime source. Pass --source <runtime-package-dir> or run npm run verify:csllm.",
    );
  }

  printVerification(await verifyPackage(targetRoot));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
