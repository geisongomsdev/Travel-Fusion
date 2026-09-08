import { Module } from '@nestjs/common';
import { LatamClient } from './latam.client';
import { LatamCommands } from './latam.commands';
import { LatamProvider } from './latam.provider';

/**
 * Tudo que sabe o que é LATAM NDC mora aqui. O módulo de voo consome o provider
 * e nunca o XML — é essa fronteira que permitiu a LATAM entrar sem mexer em
 * nenhum caso de uso.
 */
@Module({
  providers: [LatamClient, LatamCommands, LatamProvider],
  exports: [LatamProvider],
})
export class LatamModule {}
