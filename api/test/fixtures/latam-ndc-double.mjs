import http from 'node:http';

/**
 * Duble do LATAM NDC — SO PARA TESTE.
 *
 * 🔴 Nao e um modo de rodar a aplicacao: o .env aponta para o sandbox real da
 * LATAM, e este arquivo vive em test/ de proposito. Um duble alcancavel pela
 * configuracao de runtime vira producao por acidente.
 *
 * Reproduz o que o teste de integracao precisa exercitar:
 *  - o OAuth2 devolve access_token + expires_in e o resto exige o Bearer;
 *  - a busca e SINCRONA — uma resposta traz todas as ofertas;
 *  - as ofertas referenciam DataLists por id (PaxJourney → PaxSegment);
 *  - o erro vem com HTTP 200 e <Error><Code> de 9 digitos.
 */
const PORT = process.env.MOCK_LATAM_PORT || 3998;

const DATA_LISTS = `
  <DataLists>
    <BaggageAllowanceList>
      <BaggageAllowance>
        <BaggageAllowanceID>CARRY_ON_10_22_1</BaggageAllowanceID>
        <DescText>Bagagem de mão, 1 peça</DescText>
        <PieceAllowance><TotalQty>1</TotalQty></PieceAllowance>
        <TypeCode>CarryOn</TypeCode>
      </BaggageAllowance>
      <BaggageAllowance>
        <BaggageAllowanceID>CHECKED_23_1</BaggageAllowanceID>
        <DescText>Bagagem despachada, 1 peça até 23kg</DescText>
        <PieceAllowance><TotalQty>1</TotalQty></PieceAllowance>
        <TypeCode>Checked</TypeCode>
        <WeightAllowance>
          <MaximumWeightMeasure UnitCode="KG">23</MaximumWeightMeasure>
        </WeightAllowance>
      </BaggageAllowance>
    </BaggageAllowanceList>
    <PaxJourneyList>
      <PaxJourney>
        <PaxJourneyID>FL_GRUREC_1</PaxJourneyID>
        <PaxSegmentRefID>SEG_GRU_REC_3050</PaxSegmentRefID>
      </PaxJourney>
      <PaxJourney>
        <PaxJourneyID>FL_RECGRU_1</PaxJourneyID>
        <PaxSegmentRefID>SEG_REC_GRU_3051</PaxSegmentRefID>
      </PaxJourney>
      <PaxJourney>
        <PaxJourneyID>FL_GRUREC_2</PaxJourneyID>
        <PaxSegmentRefID>SEG_GRU_CGH_3060</PaxSegmentRefID>
        <PaxSegmentRefID>SEG_CGH_REC_3061</PaxSegmentRefID>
      </PaxJourney>
    </PaxJourneyList>
    <PaxSegmentList>
      <PaxSegment>
        <Arrival>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-12T11:40:00</AircraftScheduledDateTime>
          <IATA_LocationCode>REC</IATA_LocationCode>
        </Arrival>
        <CabinType><CabinTypeCode>Y</CabinTypeCode><CabinTypeName>Economy</CabinTypeName></CabinType>
        <DatedOperatingLeg>
          <CarrierAircraftType><CarrierAircraftTypeCode>32A</CarrierAircraftTypeCode></CarrierAircraftType>
        </DatedOperatingLeg>
        <Dep>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-12T08:15:00</AircraftScheduledDateTime>
          <IATA_LocationCode>GRU</IATA_LocationCode>
        </Dep>
        <Duration>PT3H25M</Duration>
        <MarketingCarrierInfo>
          <CarrierDesigCode>LA</CarrierDesigCode>
          <MarketingCarrierFlightNumberText>3050</MarketingCarrierFlightNumberText>
        </MarketingCarrierInfo>
        <OperatingCarrierInfo><CarrierDesigCode>LA</CarrierDesigCode></OperatingCarrierInfo>
        <PaxSegmentID>SEG_GRU_REC_3050</PaxSegmentID>
      </PaxSegment>
      <PaxSegment>
        <Arrival>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-19T22:05:00</AircraftScheduledDateTime>
          <IATA_LocationCode>GRU</IATA_LocationCode>
        </Arrival>
        <CabinType><CabinTypeCode>Y</CabinTypeCode><CabinTypeName>Economy</CabinTypeName></CabinType>
        <Dep>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-19T18:30:00</AircraftScheduledDateTime>
          <IATA_LocationCode>REC</IATA_LocationCode>
        </Dep>
        <Duration>PT3H35M</Duration>
        <MarketingCarrierInfo>
          <CarrierDesigCode>LA</CarrierDesigCode>
          <MarketingCarrierFlightNumberText>3051</MarketingCarrierFlightNumberText>
        </MarketingCarrierInfo>
        <OperatingCarrierInfo><CarrierDesigCode>LA</CarrierDesigCode></OperatingCarrierInfo>
        <PaxSegmentID>SEG_REC_GRU_3051</PaxSegmentID>
      </PaxSegment>
      <PaxSegment>
        <Arrival>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-12T07:20:00</AircraftScheduledDateTime>
          <IATA_LocationCode>CGH</IATA_LocationCode>
        </Arrival>
        <CabinType><CabinTypeCode>Y</CabinTypeCode><CabinTypeName>Economy</CabinTypeName></CabinType>
        <Dep>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-12T06:30:00</AircraftScheduledDateTime>
          <IATA_LocationCode>GRU</IATA_LocationCode>
        </Dep>
        <MarketingCarrierInfo>
          <CarrierDesigCode>LA</CarrierDesigCode>
          <MarketingCarrierFlightNumberText>3060</MarketingCarrierFlightNumberText>
        </MarketingCarrierInfo>
        <PaxSegmentID>SEG_GRU_CGH_3060</PaxSegmentID>
      </PaxSegment>
      <PaxSegment>
        <Arrival>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-12T11:15:00</AircraftScheduledDateTime>
          <IATA_LocationCode>REC</IATA_LocationCode>
        </Arrival>
        <CabinType><CabinTypeCode>Y</CabinTypeCode><CabinTypeName>Economy</CabinTypeName></CabinType>
        <Dep>
          <AircraftScheduledDateTime TimeZoneCode="-03:00">2026-10-12T08:05:00</AircraftScheduledDateTime>
          <IATA_LocationCode>CGH</IATA_LocationCode>
        </Dep>
        <MarketingCarrierInfo>
          <CarrierDesigCode>LA</CarrierDesigCode>
          <MarketingCarrierFlightNumberText>3061</MarketingCarrierFlightNumberText>
        </MarketingCarrierInfo>
        <PaxSegmentID>SEG_CGH_REC_3061</PaxSegmentID>
      </PaxSegment>
    </PaxSegmentList>
    <PriceClassList>
      <PriceClass>
        <PriceClassID>PC_LIGHT</PriceClassID>
        <Code>LIGHT</Code>
        <Name>Light</Name>
      </PriceClass>
      <PriceClass>
        <PriceClassID>PC_PLUS</PriceClassID>
        <Code>PLUS</Code>
        <Name>Plus</Name>
      </PriceClass>
    </PriceClassList>
  </DataLists>`;

/** Uma oferta = um pacote. `journeys` são os bounds, na ordem do itinerário. */
function offer({ id, journeys, priceClass, baggage, base, tax, refundable, changeable }) {
  const total = base + tax;
  const services = journeys
    .map((journeyId) => `
        <Service>
          <PaxRefID>ADT_1</PaxRefID>
          <ServiceAssociations><PaxJourneyRefID>${journeyId}</PaxJourneyRefID></ServiceAssociations>
          <ServiceID>SVC_${journeyId}</ServiceID>
        </Service>`)
    .join('');

  return `
      <Offer>
        <BaggageAllowance>
          <BaggageAllowanceRefID>${baggage}</BaggageAllowanceRefID>
          <PaxRefID>ADT_1</PaxRefID>
        </BaggageAllowance>
        <OfferID>${id}</OfferID>
        <OfferItem>
          <CancelRestrictions>
            <AllowedModificationInd>${refundable}</AllowedModificationInd>
            <PaxRefID>ADT_1</PaxRefID>
          </CancelRestrictions>
          <ChangeRestrictions>
            <AllowedModificationInd>${changeable}</AllowedModificationInd>
            <PaxRefID>ADT_1</PaxRefID>
          </ChangeRestrictions>
          <FareDetail>
            <FareComponent>
              <FareBasisCode>ONHMAG2J</FareBasisCode>
              <PriceClassRefID>${priceClass}</PriceClassRefID>
              <RBD><RBD_Code>Y</RBD_Code></RBD>
            </FareComponent>
            <FarePriceType>
              <FarePriceTypeCode>SELL_AMOUNT</FarePriceTypeCode>
              <Price>
                <BaseAmount CurCode="BRL">${base}</BaseAmount>
                <TaxSummary><TotalTaxAmount CurCode="BRL">${tax}</TotalTaxAmount></TaxSummary>
                <TotalAmount CurCode="BRL">${total}</TotalAmount>
              </Price>
            </FarePriceType>
            <FareRefText>${priceClass === 'PC_PLUS' ? 'PLUS' : 'LIGHT'}</FareRefText>
            <PaxRefID>ADT_1</PaxRefID>
          </FareDetail>
          <OfferItemID>ITEM_${id}</OfferItemID>${services}
        </OfferItem>
        <OwnerCode>LA</OwnerCode>
        <TotalPrice>
          <BaseAmount CurCode="BRL">${base}</BaseAmount>
          <TaxSummary><TotalTaxAmount CurCode="BRL">${tax}</TotalTaxAmount></TaxSummary>
          <TotalAmount CurCode="BRL">${total}</TotalAmount>
        </TotalPrice>
      </Offer>`;
}

const AIR_SHOPPING = `<?xml version="1.0" encoding="UTF-8"?>
<IATA_AirShoppingRS xmlns="http://www.iata.org/IATA/2015/00/2019.2/IATA_AirShoppingRS">
  <Response>${DATA_LISTS}
    <OffersGroup>
      <CarrierOffers>${offer({
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        journeys: ['FL_GRUREC_1', 'FL_RECGRU_1'],
        priceClass: 'PC_LIGHT',
        baggage: 'CARRY_ON_10_22_1',
        base: 520,
        tax: 105,
        refundable: 'false',
        changeable: 'true',
      })}${offer({
        id: 'a1b2c3d4-0002-4000-8000-000000000002',
        journeys: ['FL_GRUREC_2', 'FL_RECGRU_1'],
        priceClass: 'PC_PLUS',
        baggage: 'CHECKED_23_1',
        base: 760,
        tax: 128,
        refundable: 'true',
        changeable: 'true',
      })}${offer({
        id: 'a1b2c3d4-0003-4000-8000-000000000003',
        journeys: ['FL_GRUREC_1'],
        priceClass: 'PC_LIGHT',
        baggage: 'CARRY_ON_10_22_1',
        base: 310,
        tax: 68,
        refundable: 'false',
        changeable: 'false',
      })}
      </CarrierOffers>
    </OffersGroup>
  </Response>
</IATA_AirShoppingRS>`;

const OFFER_PRICE = `<?xml version="1.0" encoding="UTF-8"?>
<IATA_OfferPriceRS xmlns="http://www.iata.org/IATA/2015/00/2019.2/IATA_OfferPriceRS">
  <Response>
    <PricedOffer>
      <Offer>
        <OfferID>a1b2c3d4-0001-4000-8000-000000000001</OfferID>
        <TotalPrice>
          <BaseAmount CurCode="BRL">520</BaseAmount>
          <TaxSummary><TotalTaxAmount CurCode="BRL">105</TotalTaxAmount></TaxSummary>
          <TotalAmount CurCode="BRL">625</TotalAmount>
        </TotalPrice>
      </Offer>
    </PricedOffer>
  </Response>
</IATA_OfferPriceRS>`;

const ORDER_VIEW = `<?xml version="1.0" encoding="UTF-8"?>
<IATA_OrderViewRS xmlns="http://www.iata.org/IATA/2015/00/2019.2/IATA_OrderViewRS">
  <Response>
    <Order>
      <OrderID>ORD-77213</OrderID>
      <BookingRef><ID>NW6PFQ</ID></BookingRef>
      <StatusCode>CLOSED</StatusCode>
      <OwnerCode>LA</OwnerCode>
      <CreateDateTime>2026-09-04T18:22:10Z</CreateDateTime>
      <TotalPrice><TotalAmount CurCode="BRL">625</TotalAmount></TotalPrice>
    </Order>
    <DataLists>
      <PaxList>
        <Pax>
          <PaxID>ADT_1</PaxID>
          <PTC>ADT</PTC>
          <Birthdate>1990-04-21</Birthdate>
          <Individual><GivenName>Andy</GivenName><Surname>Peterson</Surname></Individual>
        </Pax>
      </PaxList>
    </DataLists>
  </Response>
</IATA_OrderViewRS>`;

/** Erro no formato real: HTTP 200, código de 9 dígitos com o status embutido. */
const routeNotSold = `<?xml version="1.0" encoding="UTF-8"?>
<IATA_AirShoppingRS xmlns="http://www.iata.org/IATA/2015/00/2019.2/IATA_AirShoppingRS">
  <Error>
    <Code>404122007</Code>
    <DescText>There was a problem with the search. We don't sell this segment for the selected date.</DescText>
  </Error>
</IATA_AirShoppingRS>`;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });

  req.on('end', () => {
    const url = req.url.split('?')[0];

    if (url.endsWith('/token')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 3540 }));
      return;
    }

    // Tudo que não é token exige o Bearer — é assim no Apigee.
    if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_token' }));
      return;
    }

    const xml = (payload) => {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(payload);
    };

    if (url.endsWith('/airshopping')) {
      // Rota fora da malha devolve o erro, para exercitar o mapa.
      return xml(/XXX/.test(body) ? routeNotSold : AIR_SHOPPING);
    }
    if (url.endsWith('/offerprice')) return xml(OFFER_PRICE);
    if (url.endsWith('/order/create') || url.endsWith('/order/retrieve')) return xml(ORDER_VIEW);

    res.writeHead(404, { 'Content-Type': 'application/xml' });
    res.end('<Error><Code>404000001</Code><DescText>Not found</DescText></Error>');
  });
});

server.listen(PORT, () => {
  console.log(`mock LATAM NDC em http://localhost:${PORT}`);
  console.log('  LATAM_ENDPOINT=http://localhost:' + PORT);
  console.log('  LATAM_TOKEN_ENDPOINT=http://localhost:' + PORT + '/oauth/cc/token');
});
