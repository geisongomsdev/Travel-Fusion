import http from 'node:http';

/**
 * Mock do endpoint XML da Travelfusion.
 *
 * Existe porque as credenciais reais só respondem a partir de IP whitelistado —
 * hoje a busca volta `4-3448 Login ID not found`. Sem isto, nada além do desenho
 * dá para exercitar.
 *
 * Reproduz o que importa do comportamento real:
 *  - o CheckRouting é INCREMENTAL (devolve as rotas uma vez e nunca mais);
 *  - o Complete só vira true depois de algumas passadas;
 *  - o ProcessDetails traz o RequiredParameterList com o DisplayText de bagagem;
 *  - o CheckBooking passa por BookingInProgress antes de Succeeded.
 *
 * Uso: TF_ENDPOINT=http://localhost:3999/Xml node server.js
 */
const state = { polls: 0, delivered: false, bookingPolls: 0 };

const ROUTES = `
  <Route>
    <Id>RT-001</Id><OutwardId>OUT-001</OutwardId>
    <Currency>BRL</Currency>
    <BaseFare>520.00</BaseFare><Tax>75.00</Tax><Fee>30.00</Fee><TotalPrice>625.00</TotalPrice>
    <FareBasis>ONHMAG2J</FareBasis><BookingClass>Y</BookingClass><CabinClass>Economy</CabinClass>
    <FareFamily>Light</FareFamily><FareFamilyCode>LIGHT</FareFamilyCode>
    <SegmentList>
      <Segment>
        <Origin>GRU</Origin><OriginName>Guarulhos</OriginName>
        <Destination>REC</Destination><DestinationName>Recife</DestinationName>
        <DepartureDateTime>2026-10-12T08:15:00</DepartureDateTime>
        <ArrivalDateTime>2026-10-12T11:40:00</ArrivalDateTime>
        <MarketingCarrier>G3</MarketingCarrier><CarrierName>Acme Air</CarrierName>
        <FlightNumber>1042</FlightNumber><AircraftCode>73G</AircraftCode>
      </Segment>
    </SegmentList>
  </Route>
  <Route>
    <Id>RT-002</Id><OutwardId>OUT-002</OutwardId>
    <Currency>BRL</Currency>
    <BaseFare>410.00</BaseFare><Tax>75.00</Tax><Fee>30.00</Fee><TotalPrice>515.00</TotalPrice>
    <FareBasis>ONJAAG2J</FareBasis><BookingClass>O</BookingClass><CabinClass>Economy</CabinClass>
    <FareFamily>Basic</FareFamily><FareFamilyCode>BASIC</FareFamilyCode>
    <SegmentList>
      <Segment>
        <Origin>GRU</Origin><Destination>BSB</Destination>
        <DepartureDateTime>2026-10-12T06:00:00</DepartureDateTime>
        <ArrivalDateTime>2026-10-12T07:30:00</ArrivalDateTime>
        <MarketingCarrier>G3</MarketingCarrier><CarrierName>Acme Air</CarrierName>
        <FlightNumber>1500</FlightNumber>
      </Segment>
      <Segment>
        <Origin>BSB</Origin><Destination>REC</Destination>
        <DepartureDateTime>2026-10-12T08:20:00</DepartureDateTime>
        <ArrivalDateTime>2026-10-12T10:55:00</ArrivalDateTime>
        <MarketingCarrier>G3</MarketingCarrier><CarrierName>Acme Air</CarrierName>
        <FlightNumber>1620</FlightNumber>
      </Segment>
    </SegmentList>
  </Route>`;

function respond(command) {
  switch (command) {
    case 'Login':
      return '<Login><LoginId>MOCK-LOGIN-ID-123</LoginId></Login>';

    case 'StartRouting':
      state.polls = 0;
      state.delivered = false;
      return '<StartRouting><RoutingId>Z1HFJKDF8236723J</RoutingId><RouterList><Router><Name>acme</Name></Router></RouterList></StartRouting>';

    case 'CheckRouting': {
      state.polls += 1;
      const complete = state.polls >= 2;
      // Entrega as rotas UMA vez só — é assim que o provedor real se comporta.
      const routes = state.delivered ? '' : ROUTES;
      if (!state.delivered) state.delivered = true;
      return `<CheckRouting><RouterList><Router><Name>acme</Name><Complete>${complete}</Complete></Router></RouterList><RouteList>${routes}</RouteList></CheckRouting>`;
    }

    case 'ProcessDetails':
      return `<ProcessDetails>
        <Currency>BRL</Currency>
        <BaseFare>520.00</BaseFare><Tax>75.00</Tax><Fee>30.00</Fee><TotalPrice>625.00</TotalPrice>
        <RequiredParameterList>
          <RequiredParameter>
            <Name>LuggageOptions</Name><Type>value_select</Type>
            <DisplayText>Please Select Luggage Option: 1 (1 bags - 15Kg total - 25.00 BRL), 2 (1 bags - 20Kg total - 35.00 BRL), 3 (2 bags - 15Kg+15Kg - 50.00 BRL)</DisplayText>
            <PerPassenger>true</PerPassenger><IsOptional>true</IsOptional>
          </RequiredParameter>
        </RequiredParameterList>
        <FareRuleList>
          <FareRule>
            <Carrier>G3</Carrier><FareBasis>ONHMAG2J</FareBasis>
            <Origin>GRU</Origin><Destination>REC</Destination>
            <Text>50.RULE APPLICATION AND OTHER CONDITIONS
   LIGHT FARE
01.ELIGIBILITY
   NO ELIGIBILITY REQUIREMENTS APPLY.
16.PENALTIES
   CANCELLATIONS - CHARGE BRL 250.00.</Text>
          </FareRule>
        </FareRuleList>
      </ProcessDetails>`;

    case 'ProcessTerms':
      return '<ProcessTerms><Status>Ok</Status></ProcessTerms>';

    case 'StartBooking':
      state.bookingPolls = 0;
      return '<StartBooking><BookingId>BK-9001</BookingId></StartBooking>';

    case 'CheckBooking': {
      state.bookingPolls += 1;
      // Passa por BookingInProgress antes do status final — o caso que o contrato
      // chama de committed sem confirmed.
      if (state.bookingPolls < 2) {
        return '<CheckBooking><Status>BookingInProgress</Status></CheckBooking>';
      }
      return `<CheckBooking>
        <Status>Succeeded</Status>
        <SupplierReference>NW6PFQ</SupplierReference>
        <SupplierName>Acme Air</SupplierName>
        <Currency>BRL</Currency>
        <BookingDateTime>2026-09-02T15:24:00</BookingDateTime>
        <TravellerList>
          <Traveller>
            <FirstName>Andy</FirstName><LastName>Peterson</LastName>
            <DateOfBirth>1990-04-21T00:00:00</DateOfBirth>
            <Type>ADT</Type><Email>andy@example.com</Email>
          </Traveller>
          <Traveller>
            <FirstName>Bia</FirstName><LastName>Peterson</LastName>
            <DateOfBirth>2025-01-10</DateOfBirth>
            <Type>INF</Type>
          </Traveller>
        </TravellerList>
      </CheckBooking>`;
    }

    default:
      return `<CommandExecutionFailure><${command} ecode="4-0001" etext="Unknown command ${command}"/></CommandExecutionFailure>`;
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    /**
     * 🔴 O mock RECUSA request sem `<CommandList>`, exatamente como a Travelfusion
     * real (HTTP 400, `1-1043`). Sem isso o mock aceitaria um request que a
     * produção rejeita — e o bug só apareceria no dia da whitelist.
     */
    if (!/<CommandList[\s>]/.test(body)) {
      res.writeHead(400, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end('<CommandList ecode="1-1043" etext="Invalid request:Missing &lt;CommandList&gt; tag"></CommandList>');
      return;
    }

    const command = body.replace(/^[\s\S]*?<CommandList[^>]*>/, '').match(/<([A-Za-z]+)[\s>]/)?.[1] || 'Unknown';
    // A resposta espelha o envelope: erro vai em atributo, não em bloco <Error>.
    const xml = `<?xml version="1.0" encoding="UTF-8"?><CommandList>${respond(command)}</CommandList>`;
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(xml);
  });
});

const PORT = Number(process.env.MOCK_PORT || 3999);
server.listen(PORT, () => console.log(`mock travelfusion em http://localhost:${PORT}/Xml`));
