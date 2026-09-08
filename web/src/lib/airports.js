/**
 * Aeroportos da malha LATAM + principais praças da América do Sul.
 *
 * 🔴 Lista ESTÁTICA de propósito. O contrato não expõe rota de aeroportos, e
 * inventar uma só para a tela seria fingir um endpoint que a API não tem. Se um
 * dia existir `/airports`, o `useAirportSearch` troca a fonte e mais nada muda.
 */
export const AIRPORTS = [
  // Brasil
  { iata: 'GRU', city: 'São Paulo', name: 'Guarulhos', country: 'BR' },
  { iata: 'CGH', city: 'São Paulo', name: 'Congonhas', country: 'BR' },
  { iata: 'VCP', city: 'Campinas', name: 'Viracopos', country: 'BR' },
  { iata: 'GIG', city: 'Rio de Janeiro', name: 'Galeão', country: 'BR' },
  { iata: 'SDU', city: 'Rio de Janeiro', name: 'Santos Dumont', country: 'BR' },
  { iata: 'BSB', city: 'Brasília', name: 'Juscelino Kubitschek', country: 'BR' },
  { iata: 'CNF', city: 'Belo Horizonte', name: 'Confins', country: 'BR' },
  { iata: 'POA', city: 'Porto Alegre', name: 'Salgado Filho', country: 'BR' },
  { iata: 'CWB', city: 'Curitiba', name: 'Afonso Pena', country: 'BR' },
  { iata: 'FLN', city: 'Florianópolis', name: 'Hercílio Luz', country: 'BR' },
  { iata: 'SSA', city: 'Salvador', name: 'Deputado Luís Eduardo Magalhães', country: 'BR' },
  { iata: 'REC', city: 'Recife', name: 'Guararapes', country: 'BR' },
  { iata: 'FOR', city: 'Fortaleza', name: 'Pinto Martins', country: 'BR' },
  { iata: 'NAT', city: 'Natal', name: 'São Gonçalo do Amarante', country: 'BR' },
  { iata: 'MCZ', city: 'Maceió', name: 'Zumbi dos Palmares', country: 'BR' },
  { iata: 'AJU', city: 'Aracaju', name: 'Santa Maria', country: 'BR' },
  { iata: 'JPA', city: 'João Pessoa', name: 'Castro Pinto', country: 'BR' },
  { iata: 'THE', city: 'Teresina', name: 'Senador Petrônio Portella', country: 'BR' },
  { iata: 'SLZ', city: 'São Luís', name: 'Marechal Cunha Machado', country: 'BR' },
  { iata: 'BEL', city: 'Belém', name: 'Val de Cans', country: 'BR' },
  { iata: 'MAO', city: 'Manaus', name: 'Eduardo Gomes', country: 'BR' },
  { iata: 'CGB', city: 'Cuiabá', name: 'Marechal Rondon', country: 'BR' },
  { iata: 'CGR', city: 'Campo Grande', name: 'Campo Grande', country: 'BR' },
  { iata: 'GYN', city: 'Goiânia', name: 'Santa Genoveva', country: 'BR' },
  { iata: 'VIX', city: 'Vitória', name: 'Eurico de Aguiar Salles', country: 'BR' },
  { iata: 'IGU', city: 'Foz do Iguaçu', name: 'Cataratas', country: 'BR' },
  { iata: 'NVT', city: 'Navegantes', name: 'Ministro Victor Konder', country: 'BR' },
  { iata: 'PMW', city: 'Palmas', name: 'Brigadeiro Lysias Rodrigues', country: 'BR' },
  { iata: 'PVH', city: 'Porto Velho', name: 'Governador Jorge Teixeira', country: 'BR' },
  { iata: 'RBR', city: 'Rio Branco', name: 'Plácido de Castro', country: 'BR' },
  { iata: 'BPS', city: 'Porto Seguro', name: 'Porto Seguro', country: 'BR' },
  { iata: 'IOS', city: 'Ilhéus', name: 'Jorge Amado', country: 'BR' },
  { iata: 'JOI', city: 'Joinville', name: 'Lauro Carneiro de Loyola', country: 'BR' },
  { iata: 'LDB', city: 'Londrina', name: 'Governador José Richa', country: 'BR' },
  { iata: 'MGF', city: 'Maringá', name: 'Sílvio Name Júnior', country: 'BR' },
  { iata: 'RAO', city: 'Ribeirão Preto', name: 'Leite Lopes', country: 'BR' },
  { iata: 'UDI', city: 'Uberlândia', name: 'Ten. Cel. Av. César Bombonato', country: 'BR' },
  { iata: 'FEN', city: 'Fernando de Noronha', name: 'Fernando de Noronha', country: 'BR' },

  // Chile
  { iata: 'SCL', city: 'Santiago', name: 'Arturo Merino Benítez', country: 'CL' },
  { iata: 'CJC', city: 'Calama', name: 'El Loa', country: 'CL' },
  { iata: 'ANF', city: 'Antofagasta', name: 'Cerro Moreno', country: 'CL' },
  { iata: 'IQQ', city: 'Iquique', name: 'Diego Aracena', country: 'CL' },
  { iata: 'PMC', city: 'Puerto Montt', name: 'El Tepual', country: 'CL' },
  { iata: 'PUQ', city: 'Punta Arenas', name: 'Presidente Ibáñez', country: 'CL' },
  { iata: 'CCP', city: 'Concepción', name: 'Carriel Sur', country: 'CL' },
  { iata: 'IPC', city: 'Ilha de Páscoa', name: 'Mataveri', country: 'CL' },

  // Peru, Colômbia, Equador, Bolívia, Paraguai, Uruguai, Argentina
  { iata: 'LIM', city: 'Lima', name: 'Jorge Chávez', country: 'PE' },
  { iata: 'CUZ', city: 'Cusco', name: 'Alejandro Velasco Astete', country: 'PE' },
  { iata: 'AQP', city: 'Arequipa', name: 'Rodríguez Ballón', country: 'PE' },
  { iata: 'BOG', city: 'Bogotá', name: 'El Dorado', country: 'CO' },
  { iata: 'MDE', city: 'Medellín', name: 'José María Córdova', country: 'CO' },
  { iata: 'CTG', city: 'Cartagena', name: 'Rafael Núñez', country: 'CO' },
  { iata: 'CLO', city: 'Cali', name: 'Alfonso Bonilla Aragón', country: 'CO' },
  { iata: 'UIO', city: 'Quito', name: 'Mariscal Sucre', country: 'EC' },
  { iata: 'GYE', city: 'Guayaquil', name: 'José Joaquín de Olmedo', country: 'EC' },
  { iata: 'VVI', city: 'Santa Cruz de la Sierra', name: 'Viru Viru', country: 'BO' },
  { iata: 'LPB', city: 'La Paz', name: 'El Alto', country: 'BO' },
  { iata: 'ASU', city: 'Assunção', name: 'Silvio Pettirossi', country: 'PY' },
  { iata: 'MVD', city: 'Montevidéu', name: 'Carrasco', country: 'UY' },
  { iata: 'EZE', city: 'Buenos Aires', name: 'Ezeiza', country: 'AR' },
  { iata: 'AEP', city: 'Buenos Aires', name: 'Jorge Newbery', country: 'AR' },
  { iata: 'COR', city: 'Córdoba', name: 'Ingeniero Taravella', country: 'AR' },
  { iata: 'MDZ', city: 'Mendoza', name: 'El Plumerillo', country: 'AR' },
  { iata: 'BRC', city: 'Bariloche', name: 'Teniente Candelaria', country: 'AR' },

  // América do Norte, Europa e Oceania
  { iata: 'MIA', city: 'Miami', name: 'Miami International', country: 'US' },
  { iata: 'JFK', city: 'Nova York', name: 'John F. Kennedy', country: 'US' },
  { iata: 'LAX', city: 'Los Angeles', name: 'Los Angeles International', country: 'US' },
  { iata: 'MCO', city: 'Orlando', name: 'Orlando International', country: 'US' },
  { iata: 'IAH', city: 'Houston', name: 'George Bush', country: 'US' },
  { iata: 'BOS', city: 'Boston', name: 'Logan', country: 'US' },
  { iata: 'YYZ', city: 'Toronto', name: 'Pearson', country: 'CA' },
  { iata: 'MEX', city: 'Cidade do México', name: 'Benito Juárez', country: 'MX' },
  { iata: 'CUN', city: 'Cancún', name: 'Cancún', country: 'MX' },
  { iata: 'PTY', city: 'Cidade do Panamá', name: 'Tocumen', country: 'PA' },
  { iata: 'MAD', city: 'Madri', name: 'Barajas', country: 'ES' },
  { iata: 'BCN', city: 'Barcelona', name: 'El Prat', country: 'ES' },
  { iata: 'LIS', city: 'Lisboa', name: 'Humberto Delgado', country: 'PT' },
  { iata: 'CDG', city: 'Paris', name: 'Charles de Gaulle', country: 'FR' },
  { iata: 'LHR', city: 'Londres', name: 'Heathrow', country: 'GB' },
  { iata: 'FRA', city: 'Frankfurt', name: 'Frankfurt am Main', country: 'DE' },
  { iata: 'FCO', city: 'Roma', name: 'Fiumicino', country: 'IT' },
  { iata: 'AKL', city: 'Auckland', name: 'Auckland', country: 'NZ' },
  { iata: 'SYD', city: 'Sydney', name: 'Kingsford Smith', country: 'AU' },
];

/** Índice IATA → aeroporto, para resolver o valor inicial do formulário. */
const BY_IATA = new Map(AIRPORTS.map((airport) => [airport.iata, airport]));

export const airportByIata = (iata) => BY_IATA.get((iata ?? '').toUpperCase()) ?? null;

/** `São Paulo (GRU)` — o mesmo rótulo que o `AirportRow` do design system grava. */
export const airportLabel = (airport) => (airport ? `${airport.city} (${airport.iata})` : '');

/** Acentos fora: quem digita "sao paulo" tem que achar "São Paulo". */
const fold = (text) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Busca por IATA, cidade, nome do aeroporto ou país.
 *
 * O IATA exato vem primeiro, e cidade que COMEÇA com o termo vem antes de
 * cidade que só o contém — digitar "sal" deve trazer Salvador antes de
 * "Mariscal Sucre".
 */
export function searchAirports(query, limit = 8) {
  const term = fold(query).trim();
  if (term.length === 0) return [];

  const scored = [];
  for (const airport of AIRPORTS) {
    const iata = airport.iata.toLowerCase();
    const city = fold(airport.city);
    const name = fold(airport.name);

    let score = null;
    if (iata === term) score = 0;
    else if (city.startsWith(term)) score = 1;
    else if (iata.startsWith(term)) score = 2;
    else if (city.includes(term)) score = 3;
    else if (name.includes(term)) score = 4;
    else if (fold(airport.country).startsWith(term)) score = 5;

    if (score !== null) scored.push({ airport, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.airport.city.localeCompare(b.airport.city))
    .slice(0, limit)
    .map((entry) => entry.airport);
}
