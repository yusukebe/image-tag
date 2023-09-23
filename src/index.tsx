import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { middleware } from 'hono/factory'
import { renderer } from './renderer'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

type Bindings = {
  DB: D1Database
  BUCKET: R2Bucket
  BASIC_AUTH_USERNAME: string
  BASIC_AUTH_PASSWORD: string
}

const schema = z.object({
  file: z.instanceof(File),
  tag: z.string().min(1)
})

type Image = {
  id: string
  tag: string
  created_at: string
}

const app = new Hono<{
  Bindings: Bindings
}>()

const myBasicAuth = middleware<{
  Bindings: Bindings
}>(async (c, next) => {
  const auth = basicAuth({
    username: c.env.BASIC_AUTH_USERNAME,
    password: c.env.BASIC_AUTH_PASSWORD
  })
  return await auth(c, next)
})

app.get('*', async (c, next) => {
  c.setRenderer(renderer(c))
  await next()
})

app.get('/', myBasicAuth, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM images ORDER BY created_at DESC').all<Image>()
  const images = results

  return c.render(
    <>
      <h1>Top!</h1>
      <form method="POST" action="/" enctype="multipart/form-data">
        <input type="file" name="file" accept="image/*" />
        <input type="text" name="tag" />
        <button type="submit">Submit</button>
      </form>
      <div>
        {images.map((image) => {
          return (
            <div>
              <h3>{image.tag}</h3>
              <img src={`/file/${image.id}`} />
            </div>
          )
        })}
      </div>
    </>
  )
})

app.post('/', myBasicAuth, zValidator('form', schema), async (c) => {
  const { file, tag } = c.req.valid('form')
  const id = crypto.randomUUID()
  if (file instanceof File) {
    const data = await file.arrayBuffer()
    const object = await c.env.BUCKET.put(id, data, {
      httpMetadata: {
        contentType: file.type
      }
    })
    if (object) {
      console.log(`${object.key} is uploaded!`)
      const { success } = await c.env.DB.prepare('INSERT INTO images(id,tag) VALUES(?,?)').bind(id, tag).run()
      if (!success) {
        return c.text('Something went wrong', 500)
      }
    }
  }
  return c.redirect('/')
})

app.get('/api', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM images ORDER BY created_at DESC').all<Image>()
  const images = results
  return c.json(images)
})

const querySchema = z.object({
  tag: z.string().min(1)
})

app.get('/api/random', zValidator('query', querySchema), async (c) => {
  const { tag } = c.req.valid('query')
  const { results } = await c.env.DB.prepare('SELECT * FROM images WHERE tag = ? ORDER BY RANDOM() LIMIT 1')
    .bind(tag)
    .all<Image>()
  const images = results
  return c.json(images)
})

app.get('/file/:fileName', async (c) => {
  const object = await c.env.BUCKET.get(c.req.param('fileName'))
  if (object) {
    c.header('content-type', object.httpMetadata?.contentType)
    return c.body(await object.arrayBuffer())
  }
  return c.notFound()
})

export default app
