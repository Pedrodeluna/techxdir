/* Datos de ejemplo. Más adelante vendrán de Supabase (usuario de X + eventos).
   Las personas son inventadas: no son usuarios reales. */

export type OrgShape = 'circle' | 'square' | 'squircle' | 'hex' | 'diamond' | 'ring'

export interface Org {
  id: string
  name: string
  /** Monograma generado, o la URL de una imagen */
  logo: { mark: string; shape: OrgShape } | string
}

export interface TechEvent {
  id: string
  org: string
  name: string
  short: string
  city: string
  date: string
  end: string | null
  url: string | null
  kind: string
  color: string
}

export interface Person {
  id: string
  name: string
  handle: string
  role: string
  bio: string
  events: string[]
}

export interface Me {
  name: string
  handle: string
  role: string
  company: string
  bio: string
  photo: string | null
  /** año en que se sumó a la comunidad */
  joined?: number
  /** orden en que se unió: el primero es el 1 */
  memberNo?: number
}

export interface SampleData {
  orgs: Org[]
  events: TechEvent[]
  people: Person[]
  me: Me
  myEvents: string[]
}

export const SAMPLE: SampleData = {
  /* Organizaciones: cada una organiza uno o varios eventos.
     logo: { mark, shape } genera un logotipo monograma; también admite una URL de imagen. */
  orgs: [
    { id: 'hackspain',   name: 'HackSpain',      logo: { mark: 'HS', shape: 'square' } },
    { id: 'commit',      name: 'Commit Conf',    logo: { mark: 'C',  shape: 'circle' } },
    { id: 't3chfest',    name: 'T3chFest',       logo: { mark: 'T3', shape: 'hex' } },
    { id: 'bilbostack',  name: 'BilboStack',     logo: { mark: 'BS', shape: 'diamond' } },
    { id: 'gdg-madrid',  name: 'GDG Madrid',     logo: { mark: 'G',  shape: 'ring' } },
    { id: 'codemotion',  name: 'Codemotion',     logo: { mark: 'CM', shape: 'squircle' } },
    { id: 'python-es',   name: 'Python España',  logo: { mark: 'Py', shape: 'circle' } },
    { id: 'lambdaworld', name: 'Lambda World',   logo: { mark: 'λ',  shape: 'hex' } },
    { id: 'jsday',       name: 'JSDay Canarias', logo: { mark: 'JS', shape: 'square' } }
  ],

  events: [
    { id: 'hackspain-26', org: 'hackspain',    name: 'HackSpain 2026',          short: 'HackSpain',        city: 'Madrid',    date: '2026-05-09', end: '2026-05-10', url: null, kind: 'Hackathon',   color: '#ff3b5c' },
    { id: 'commit-26', org: 'commit',       name: 'Commit Conf 2026',        short: 'Commit Conf',      city: 'Madrid',    date: '2026-04-24', end: '2026-04-25', url: 'https://commitconf.com', kind: 'Conferencia', color: '#ff8a00' },
    { id: 't3chfest-26', org: 't3chfest',     name: 'T3chFest 2026',           short: 'T3chFest',         city: 'Leganés',   date: '2026-03-12', end: '2026-03-13', url: 'https://t3chfest.es', kind: 'Conferencia', color: '#6c5cff' },
    { id: 'bilbostack-26', org: 'bilbostack',   name: 'BilboStack 2026',         short: 'BilboStack',       city: 'Bilbao',    date: '2026-01-24', end: null, url: 'https://bilbostack.com', kind: 'Frontend',    color: '#00b894' },
    { id: 'devfest-mad-25', org: 'gdg-madrid',  name: 'DevFest Madrid 2025',     short: 'DevFest Madrid',   city: 'Madrid',    date: '2025-11-22', end: null, url: null, kind: 'Comunidad',   color: '#1e90ff' },
    { id: 'codemotion-25', org: 'codemotion',   name: 'Codemotion Madrid 2025',  short: 'Codemotion',       city: 'Madrid',    date: '2025-10-21', end: '2025-10-22', url: 'https://www.codemotion.com', kind: 'Conferencia', color: '#e84393' },
    { id: 'pycones-25', org: 'python-es',      name: 'PyConES 2025',            short: 'PyConES',          city: 'Sevilla',   date: '2025-10-17', end: '2025-10-19', url: 'https://es.pycon.org', kind: 'Python',      color: '#f9c80e' },
    { id: 'lambdaworld-25', org: 'lambdaworld',  name: 'Lambda World 2025',       short: 'Lambda World',     city: 'Cádiz',     date: '2025-10-02', end: '2025-10-03', url: 'https://www.lambda.world', kind: 'Funcional',   color: '#8e44ad' },
    { id: 'jsday-can-25', org: 'jsday',    name: 'JSDay Canarias 2025',     short: 'JSDay Canarias',   city: 'Tenerife',  date: '2025-09-12', end: null, url: 'https://jsdaycanarias.com', kind: 'JavaScript',  color: '#f7df1e' },
    { id: 'pycones-26', org: 'python-es',      name: 'PyConES 2026',            short: 'PyConES',          city: 'Valencia',  date: '2026-10-09', end: '2026-10-11', url: 'https://es.pycon.org', kind: 'Python',      color: '#f9c80e' },
    { id: 'codemotion-26', org: 'codemotion',   name: 'Codemotion Madrid 2026',  short: 'Codemotion',       city: 'Madrid',    date: '2026-10-20', end: '2026-10-21', url: 'https://www.codemotion.com', kind: 'Conferencia', color: '#e84393' },
    { id: 'devfest-mad-26', org: 'gdg-madrid',  name: 'DevFest Madrid 2026',     short: 'DevFest Madrid',   city: 'Madrid',    date: '2026-11-21', end: null, url: null, kind: 'Comunidad',   color: '#1e90ff' },
    { id: 'hackspain-27', org: 'hackspain',    name: 'HackSpain 2027',          short: 'HackSpain',        city: 'Barcelona', date: '2027-04-17', end: '2027-04-18', url: null, kind: 'Hackathon',   color: '#ff3b5c' }
  ],

  people: [
    { id: 'p1',  name: 'Lucía Méndez',    handle: 'luciadev',     role: 'Staff Engineer',        bio: 'Escalo sistemas y equipos. Hablo de arquitectura frontend donde me dejen.', events: ['hackspain-26', 't3chfest-26', 'codemotion-25', 'codemotion-26'] },
    { id: 'p2',  name: 'Marcos Olmedo',   handle: 'marcos_ol',    role: 'Backend · Go',          bio: 'Go, colas y café. Me encontrarás en la zona de hackathon.', events: ['hackspain-26', 'commit-26', 'devfest-mad-25'] },
    { id: 'p3',  name: 'Irene Castaño',   handle: 'irenecodes',   role: 'Data Scientist',        bio: 'Datos, notebooks y visualizaciones que cuentan algo.', events: ['pycones-25', 't3chfest-26', 'pycones-26'] },
    { id: 'p4',  name: 'Daniel Ferrer',   handle: 'dferrer',      role: 'DevRel',                bio: 'Conecto comunidades con producto. Organizo meetups en Madrid.', events: ['hackspain-26', 'bilbostack-26', 'codemotion-25', 'devfest-mad-25', 'commit-26'] },
    { id: 'p5',  name: 'Nerea Aguirre',   handle: 'nereaux',      role: 'Product Designer',      bio: 'Diseño sistemas de diseño. Figma y CSS a partes iguales.', events: ['bilbostack-26', 'jsday-can-25'] },
    { id: 'p6',  name: 'Pablo Ribas',     handle: 'pabloribas',   role: 'Frontend Lead',         bio: 'Rendimiento web y accesibilidad. Mentor en BilboStack.', events: ['bilbostack-26', 'commit-26', 'codemotion-26'] },
    { id: 'p7',  name: 'Sara Quintana',   handle: 'saraq',        role: 'Security Engineer',     bio: 'Rompo cosas para que no las rompan otros. CTFs los fines de semana.', events: ['hackspain-26', 'lambdaworld-25'] },
    { id: 'p8',  name: 'Hugo Varela',     handle: 'hugovarela',   role: 'Mobile · Kotlin',       bio: 'Apps Android con Kotlin y Compose.', events: ['devfest-mad-25', 'devfest-mad-26'] },
    { id: 'p9',  name: 'Alba Serrano',    handle: 'albaserrano',  role: 'ML Engineer',           bio: 'Llevo modelos a producción sin perder la cabeza.', events: ['t3chfest-26', 'pycones-25', 'hackspain-26'] },
    { id: 'p10', name: 'Jorge Lamas',     handle: 'jlamas',       role: 'CTO @ startup',         bio: 'Construyendo una startup de logística. Siempre contratando.', events: ['commit-26', 'codemotion-25'] },
    { id: 'p11', name: 'Carla Ibáñez',    handle: 'carlaib',      role: 'Full Stack',            bio: 'Full stack con TypeScript. Primera en llegar al hackathon.', events: ['hackspain-26', 'hackspain-27'] },
    { id: 'p12', name: 'Rubén Soler',     handle: 'rubensoler',   role: 'Platform Engineer',     bio: 'Kubernetes, plataformas internas y developer experience.', events: ['lambdaworld-25', 'commit-26', 't3chfest-26'] },
    { id: 'p13', name: 'Marta Gil',       handle: 'martagil_',    role: 'QA Automation',         bio: 'Automatizo pruebas para dormir tranquila.', events: ['codemotion-25', 'codemotion-26'] },
    { id: 'p14', name: 'Iker Etxeberria', handle: 'iker_etx',     role: 'Frontend · Vue',        bio: 'Vue, Nuxt y pintxos.', events: ['bilbostack-26'] },
    { id: 'p15', name: 'Noelia Prieto',   handle: 'noeprieto',    role: 'Engineering Manager',   bio: 'Gestiono equipos de ingeniería. Escribo sobre liderazgo técnico.', events: ['t3chfest-26', 'devfest-mad-25', 'commit-26'] },
    { id: 'p16', name: 'Óscar Benítez',   handle: 'oscarbnz',     role: 'Cloud Architect',       bio: 'Arquitecturas cloud y serverless.', events: ['jsday-can-25', 'pycones-26'] },
    { id: 'p17', name: 'Elena Robles',    handle: 'elenarobles',  role: 'Open Source',           bio: 'Mantengo librerías open source. Charlas sobre comunidad.', events: ['hackspain-26', 'codemotion-25', 't3chfest-26', 'bilbostack-26'] },
    { id: 'p18', name: 'Víctor Campos',   handle: 'vcampos',      role: 'Estudiante · UPM',      bio: 'Estudiante de Ingeniería Informática buscando prácticas.', events: ['hackspain-26', 'devfest-mad-25'] }
  ],

  me: {
    name: 'Alex Rivera',
    handle: 'alexrivera',
    role: 'Frontend Developer',
    company: 'Freelance',
    bio: 'Construyo interfaces rápidas y accesibles. Siempre en la fila del café.',
    photo: null,
    joined: 2024,
    memberNo: 42
  },

  myEvents: ['hackspain-26', 't3chfest-26', 'bilbostack-26', 'codemotion-25', 'devfest-mad-25', 'commit-26', 'codemotion-26']
}
