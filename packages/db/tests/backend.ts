// Спільний вибір бази для тестів пакета: PG_TEST_URL як є, інакше
// @testcontainers/postgresql, інакше — скіп із причиною (див. README).
// Раунд 4, крок 3 (b): тест міграції 0023 теж іде цією дорогою, щоб CI без
// PG_TEST_URL його не скіпав.

export interface Backend {
  url: string;
  stop?: () => Promise<void>;
}

export async function pickBackend(): Promise<Backend | { skip: string }> {
  const url = process.env.PG_TEST_URL;
  if (url) return { url };
  try {
    const mod = await import('@testcontainers/postgresql');
    const container = await new mod.PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('kitchen')
      .withUsername('kitchen')
      .withPassword('kitchen')
      .start();
    return { url: container.getConnectionUri(), stop: async () => { await container.stop(); } };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return { skip: `Docker недоступний (${msg.slice(0, 80)}) і PG_TEST_URL не задано` };
  }
}
