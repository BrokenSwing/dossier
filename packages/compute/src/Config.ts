import * as Config from "effect/Config";

export const AppConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(3002)),
  storageUrl: Config.string("STORAGE_URL").pipe(Config.withDefault("http://localhost:3001")),
});
