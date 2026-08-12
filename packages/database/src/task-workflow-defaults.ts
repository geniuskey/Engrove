import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';

const defaultStatuses = [
  { key: 'todo', name: 'To do', category: 'todo', color: 'slate', position: 0, initial: true },
  {
    key: 'in_progress',
    name: 'In progress',
    category: 'in_progress',
    color: 'sky',
    position: 1,
    initial: false,
  },
  {
    key: 'blocked',
    name: 'Blocked',
    category: 'in_progress',
    color: 'rose',
    position: 2,
    initial: false,
  },
  { key: 'done', name: 'Done', category: 'done', color: 'emerald', position: 3, initial: false },
] as const;

export async function seedDefaultTaskWorkflow(
  client: PoolClient,
  projectId: string,
  actorId: string,
): Promise<void> {
  for (const status of defaultStatuses)
    await client.query(
      `insert into task_workflow_statuses
       (id,project_id,key,name,category,color,position,initial,created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uuidv7(),
        projectId,
        status.key,
        status.name,
        status.category,
        status.color,
        status.position,
        status.initial,
        actorId,
      ],
    );
  for (const from of defaultStatuses)
    for (const to of defaultStatuses) {
      if (from.key === to.key) continue;
      const name =
        to.key === 'done' ? 'Complete' : from.key === 'done' ? 'Reopen' : `Move to ${to.name}`;
      await client.query(
        `insert into task_workflow_transitions
         (id,project_id,name,from_status,to_status,created_by) values ($1,$2,$3,$4,$5,$6)`,
        [uuidv7(), projectId, name, from.key, to.key, actorId],
      );
    }
}
