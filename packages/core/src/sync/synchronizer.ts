import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { MerkleDAG } from './merkle';
import * as os from 'os';
import { minimatch } from 'minimatch';

export class FileSynchronizer {
    private fileHashes: Map<string, string>;
    private merkleDAG: MerkleDAG;
    private rootDir: string;
    private snapshotPath: string;
    private ignorePatterns: string[];

    constructor(rootDir: string, ignorePatterns: string[] = []) {
        this.rootDir = rootDir;
        this.snapshotPath = this.getSnapshotPath(rootDir);
        this.fileHashes = new Map();
        this.merkleDAG = new MerkleDAG();
        this.ignorePatterns = ignorePatterns;
    }

    private getSnapshotPath(codebasePath: string): string {
        const homeDir = os.homedir();
        const merkleDir = path.join(homeDir, '.context', 'merkle');

        const normalizedPath = path.resolve(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');

        return path.join(merkleDir, `${hash}.json`);
    }

    private async hashFile(filePath: string): Promise<string> {
        // Double-check that this is actually a file, not a directory
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
            throw new Error(`Attempted to hash a directory: ${filePath}`);
        }
        const content = await fs.readFile(filePath, 'utf-8');
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private async generateFileHashes(dir: string): Promise<Map<string, string>> {
        const fileHashes = new Map<string, string>();

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (error: any) {
            console.warn(`[Synchronizer] Cannot read directory ${dir}: ${error.message}`);
            return fileHashes;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.rootDir, fullPath);

            // Check if this path should be ignored BEFORE any file system operations
            if (this.shouldIgnore(relativePath, entry.isDirectory())) {
                continue; // Skip completely - no access at all
            }

            // Double-check with fs.stat to be absolutely sure about file type
            let stat;
            try {
                stat = await fs.stat(fullPath);
            } catch (error: any) {
                console.warn(`[Synchronizer] Cannot stat ${fullPath}: ${error.message}`);
                continue;
            }

            if (stat.isDirectory()) {
                // Verify it's really a directory and not ignored
                if (!this.shouldIgnore(relativePath, true)) {
                    const subHashes = await this.generateFileHashes(fullPath);
                    const entries = Array.from(subHashes.entries());
                    for (let i = 0; i < entries.length; i++) {
                        const [p, h] = entries[i];
                        fileHashes.set(p, h);
                    }
                }
            } else if (stat.isFile()) {
                // Verify it's really a file and not ignored
                if (!this.shouldIgnore(relativePath, false)) {
                    try {
                        const hash = await this.hashFile(fullPath);
                        fileHashes.set(relativePath, hash);
                    } catch (error: any) {
                        console.warn(`[Synchronizer] Cannot hash file ${fullPath}: ${error.message}`);
                        continue;
                    }
                }
            }
            // Skip other types (symlinks, etc.)
        }
        return fileHashes;
    }

    /**
     * Check if a path should be ignored based on gitignore-style patterns.
     *
     * Gitignore pattern semantics:
     * - Leading `/` means root-relative (only matches at repository root)
     * - Trailing `/` means directory-only pattern (matches dir and all contents)
     * - `**` matches any number of directories
     * - `*` matches anything except `/`
     * - No `/` in pattern means match anywhere in path
     * - `/` in middle of pattern means path pattern (match from root or anywhere)
     */
    private shouldIgnore(relativePath: string, isDirectory: boolean = false): boolean {
        // Always ignore hidden files and directories (starting with .)
        const pathParts = relativePath.split(path.sep);
        if (pathParts.some(part => part.startsWith('.'))) {
            return true;
        }

        if (this.ignorePatterns.length === 0) {
            return false;
        }

        // Normalize path: use forward slashes, remove leading/trailing slashes
        const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

        if (!normalizedPath) {
            return false; // Don't ignore root
        }

        // For directories, also check if path with trailing slash matches
        const pathToCheck = isDirectory ? normalizedPath + '/' : normalizedPath;

        for (const rawPattern of this.ignorePatterns) {
            if (this.matchGitignorePattern(normalizedPath, pathToCheck, rawPattern, isDirectory)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Match a path against a gitignore-style pattern using minimatch.
     */
    private matchGitignorePattern(
        normalizedPath: string,
        pathWithSlash: string,
        rawPattern: string,
        isDirectory: boolean
    ): boolean {
        if (!rawPattern || rawPattern.startsWith('#')) {
            return false; // Empty or comment
        }

        let pattern = rawPattern.trim();
        if (!pattern) return false;

        // Handle negation patterns (we don't support them, but don't crash)
        if (pattern.startsWith('!')) {
            return false;
        }

        const isRootRelative = pattern.startsWith('/');
        const isDirectoryPattern = pattern.endsWith('/');

        // Remove leading slash for matching (we handle root-relative separately)
        if (isRootRelative) {
            pattern = pattern.slice(1);
        }

        // Remove trailing slash for matching
        if (isDirectoryPattern) {
            pattern = pattern.slice(0, -1);
        }

        // If pattern doesn't contain '/', it should match anywhere in the path
        const hasSlash = pattern.includes('/');

        const minimatchOpts = { dot: false, nocase: false, matchBase: !hasSlash && !isRootRelative };

        // For directory patterns, we need to match:
        // 1. The directory itself
        // 2. Any file/directory inside it
        if (isDirectoryPattern) {
            // Match the directory itself
            if (isDirectory) {
                if (minimatch(normalizedPath, pattern, minimatchOpts)) {
                    return true;
                }
                // Also try with ** for nested matches if not root-relative
                if (!isRootRelative && minimatch(normalizedPath, '**/' + pattern, minimatchOpts)) {
                    return true;
                }
            }
            // Match anything inside the directory
            const dirGlob = pattern + '/**';
            if (minimatch(normalizedPath, dirGlob, minimatchOpts)) {
                return true;
            }
            if (!isRootRelative && minimatch(normalizedPath, '**/' + dirGlob, minimatchOpts)) {
                return true;
            }
            return false;
        }

        // For root-relative patterns (started with /), only match from root
        // But also match files INSIDE if the pattern matches a directory
        if (isRootRelative) {
            // Exact match
            if (minimatch(normalizedPath, pattern, minimatchOpts)) {
                return true;
            }
            // Also check if path is inside the pattern (pattern matches a parent dir)
            // e.g., pattern "public/app" should match "public/app/bundle.js"
            if (minimatch(normalizedPath, pattern + '/**', minimatchOpts)) {
                return true;
            }
            return false;
        }

        // For patterns with /, they can match from root or as a suffix
        if (hasSlash) {
            // Handle patterns ending with /** (e.g., build/**)
            // These should match the directory itself AND contents
            if (pattern.endsWith('/**')) {
                const basePattern = pattern.slice(0, -3); // Remove /**
                // Match the directory itself
                if (minimatch(normalizedPath, basePattern, minimatchOpts)) {
                    return true;
                }
            }

            // Try exact match from root
            if (minimatch(normalizedPath, pattern, minimatchOpts)) {
                return true;
            }
            // Try matching files inside
            if (minimatch(normalizedPath, pattern + '/**', minimatchOpts)) {
                return true;
            }
            // Try as suffix with **/ prefix
            if (minimatch(normalizedPath, '**/' + pattern, minimatchOpts)) {
                return true;
            }
            // Try as suffix with files inside
            return minimatch(normalizedPath, '**/' + pattern + '/**', minimatchOpts);
        }

        // Pattern without slash: match basename anywhere using matchBase option
        return minimatch(normalizedPath, pattern, minimatchOpts);
    }

    private buildMerkleDAG(fileHashes: Map<string, string>): MerkleDAG {
        const dag = new MerkleDAG();
        const keys = Array.from(fileHashes.keys());
        const sortedPaths = keys.slice().sort(); // Create a sorted copy

        // Create a root node for the entire directory
        let valuesString = "";
        keys.forEach(key => {
            valuesString += fileHashes.get(key);
        });
        const rootNodeData = "root:" + valuesString;
        const rootNodeId = dag.addNode(rootNodeData);

        // Add each file as a child of the root
        for (const path of sortedPaths) {
            const fileData = path + ":" + fileHashes.get(path);
            dag.addNode(fileData, rootNodeId);
        }

        return dag;
    }

    public async initialize() {
        console.log(`Initializing file synchronizer for ${this.rootDir}`);
        await this.loadSnapshot();
        this.merkleDAG = this.buildMerkleDAG(this.fileHashes);
        console.log(`[Synchronizer] File synchronizer initialized. Loaded ${this.fileHashes.size} file hashes.`);
    }

    public async checkForChanges(): Promise<{ added: string[], removed: string[], modified: string[] }> {
        console.log('[Synchronizer] Checking for file changes...');

        const newFileHashes = await this.generateFileHashes(this.rootDir);
        const newMerkleDAG = this.buildMerkleDAG(newFileHashes);

        // Compare the DAGs
        const changes = MerkleDAG.compare(this.merkleDAG, newMerkleDAG);

        // If there are any changes in the DAG, we should also do a file-level comparison
        if (changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0) {
            console.log('[Synchronizer] Merkle DAG has changed. Comparing file states...');
            const fileChanges = this.compareStates(this.fileHashes, newFileHashes);

            this.fileHashes = newFileHashes;
            this.merkleDAG = newMerkleDAG;
            await this.saveSnapshot();

            console.log(`[Synchronizer] Found changes: ${fileChanges.added.length} added, ${fileChanges.removed.length} removed, ${fileChanges.modified.length} modified.`);
            return fileChanges;
        }

        console.log('[Synchronizer] No changes detected based on Merkle DAG comparison.');
        return { added: [], removed: [], modified: [] };
    }

    private compareStates(oldHashes: Map<string, string>, newHashes: Map<string, string>): { added: string[], removed: string[], modified: string[] } {
        const added: string[] = [];
        const removed: string[] = [];
        const modified: string[] = [];

        const newEntries = Array.from(newHashes.entries());
        for (let i = 0; i < newEntries.length; i++) {
            const [file, hash] = newEntries[i];
            if (!oldHashes.has(file)) {
                added.push(file);
            } else if (oldHashes.get(file) !== hash) {
                modified.push(file);
            }
        }

        const oldKeys = Array.from(oldHashes.keys());
        for (let i = 0; i < oldKeys.length; i++) {
            const file = oldKeys[i];
            if (!newHashes.has(file)) {
                removed.push(file);
            }
        }

        return { added, removed, modified };
    }

    public getFileHash(filePath: string): string | undefined {
        return this.fileHashes.get(filePath);
    }

    /**
     * Update ignore patterns for this synchronizer.
     * This allows refreshing patterns without recreating the synchronizer.
     */
    public updateIgnorePatterns(ignorePatterns: string[]): void {
        this.ignorePatterns = ignorePatterns;
        console.log(`[Synchronizer] Updated ignore patterns: ${ignorePatterns.length} patterns`);
    }

    private async saveSnapshot(): Promise<void> {
        const merkleDir = path.dirname(this.snapshotPath);
        await fs.mkdir(merkleDir, { recursive: true });

        // Convert Map to array without using iterator
        const fileHashesArray: [string, string][] = [];
        const keys = Array.from(this.fileHashes.keys());
        keys.forEach(key => {
            fileHashesArray.push([key, this.fileHashes.get(key)!]);
        });

        const data = JSON.stringify({
            fileHashes: fileHashesArray,
            merkleDAG: this.merkleDAG.serialize()
        });
        await fs.writeFile(this.snapshotPath, data, 'utf-8');
        console.log(`Saved snapshot to ${this.snapshotPath}`);
    }

    private async loadSnapshot(): Promise<void> {
        try {
            const data = await fs.readFile(this.snapshotPath, 'utf-8');
            const obj = JSON.parse(data);

            // Reconstruct Map without using constructor with iterator
            this.fileHashes = new Map();
            for (const [key, value] of obj.fileHashes) {
                this.fileHashes.set(key, value);
            }

            if (obj.merkleDAG) {
                this.merkleDAG = MerkleDAG.deserialize(obj.merkleDAG);
            }
            console.log(`Loaded snapshot from ${this.snapshotPath}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.log(`Snapshot file not found at ${this.snapshotPath}. Generating new one.`);
                this.fileHashes = await this.generateFileHashes(this.rootDir);
                this.merkleDAG = this.buildMerkleDAG(this.fileHashes);
                await this.saveSnapshot();
            } else {
                throw error;
            }
        }
    }

    /**
     * Delete snapshot file for a given codebase path
     */
    static async deleteSnapshot(codebasePath: string): Promise<void> {
        const homeDir = os.homedir();
        const merkleDir = path.join(homeDir, '.context', 'merkle');
        const normalizedPath = path.resolve(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
        const snapshotPath = path.join(merkleDir, `${hash}.json`);

        try {
            await fs.unlink(snapshotPath);
            console.log(`Deleted snapshot file: ${snapshotPath}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.log(`Snapshot file not found (already deleted): ${snapshotPath}`);
            } else {
                console.error(`[Synchronizer] Failed to delete snapshot file ${snapshotPath}:`, error.message);
                throw error; // Re-throw non-ENOENT errors
            }
        }
    }
}