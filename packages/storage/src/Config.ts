import * as Config from "effect/Config";

export const AppConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(3001)),
  jwtSecret: Config.redacted("JWT_SECRET"),
  jwtExpirySeconds: Config.integer("JWT_EXPIRY_SECONDS").pipe(Config.withDefault(86400)),
  dbPath: Config.string("DB_PATH").pipe(Config.withDefault("./storage.db")),
  blobDir: Config.string("BLOB_DIR").pipe(Config.withDefault("./blobs")),
});
