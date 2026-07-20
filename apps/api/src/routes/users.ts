import { Elysia, t } from 'elysia'
import { USER_ROLES, type User } from '@universe/contracts'

/**
 * TypeBox schemas live here, not in @universe/contracts — they are runtime
 * values, and shipping them to the browser would drag Elysia into the bundle.
 * The web/mobile side gets its types from Eden instead.
 */
/**
 * `t.UnionEnum` keeps the literal union ('admin' | 'member') intact.
 * `t.Union(USER_ROLES.map(t.Literal))` looks equivalent but is not — `.map`
 * widens the tuple to an array, TypeBox loses the literals, and every `role`
 * downstream infers as `never`.
 */
const UserRoleSchema = t.UnionEnum(USER_ROLES)

const UserSchema = t.Object({
  id: t.String(),
  email: t.String({ format: 'email' }),
  name: t.String(),
  role: UserRoleSchema,
  createdAt: t.String(),
})

const ErrorSchema = t.Object({
  code: t.String(),
  message: t.String(),
})

// Placeholder store. Swap for a real db in packages/db later.
const users = new Map<string, User>([
  [
    'u_1',
    {
      id: 'u_1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
])

export const usersRoutes = new Elysia({ prefix: '/users', tags: ['users'] })
  .get('/', () => [...users.values()], {
    response: { 200: t.Array(UserSchema) },
    detail: { summary: 'List all users' },
  })

  .get(
    '/:id',
    ({ params, status }) => {
      const user = users.get(params.id)
      if (!user) return status(404, { code: 'user_not_found', message: `No user with id ${params.id}` })
      return user
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: UserSchema, 404: ErrorSchema },
      detail: { summary: 'Get one user by id' },
    },
  )

  .post(
    '/',
    ({ body, status }) => {
      const duplicate = [...users.values()].some((u) => u.email === body.email)
      if (duplicate) return status(409, { code: 'email_taken', message: `${body.email} is already registered` })

      const user: User = {
        id: `u_${users.size + 1}`,
        email: body.email,
        name: body.name,
        role: body.role ?? 'member',
        createdAt: new Date().toISOString(),
      }
      users.set(user.id, user)
      return status(201, user)
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        name: t.String({ minLength: 1 }),
        role: t.Optional(UserRoleSchema),
      }),
      response: { 201: UserSchema, 409: ErrorSchema },
      detail: { summary: 'Create a user' },
    },
  )
