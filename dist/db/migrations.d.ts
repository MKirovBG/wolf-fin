import Database from 'better-sqlite3';
/**
 * Creates the schema_migrations tracking table (if needed), then runs any
 * migrations whose version number is not yet recorded.
 * Returns the list of migration names that were applied.
 */
export declare function runMigrations(db: Database.Database): string[];
/** Returns a snapshot of all applied migrations (for the health endpoint). */
export declare function getMigrationStatus(db: Database.Database): Array<{
    version: number;
    name: string;
    appliedAt: string;
}>;
//# sourceMappingURL=migrations.d.ts.map