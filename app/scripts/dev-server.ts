import { apiServer } from '../server/http-adapter';
const server = apiServer();
server.listen(3001, '0.0.0.0', () =>
  console.log(
    'Local planner API listening on port 3001. No external jobs or emails are started.'
  )
);
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
