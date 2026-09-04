import { Module } from '@nestjs/common';
import { TravelfusionClient } from './travelfusion.client';
import { TravelfusionCommands } from './travelfusion.commands';
import { TravelfusionProvider } from './travelfusion.provider';

/**
 * Tudo que sabe o que é Travelfusion mora aqui. O módulo de voo consome o
 * provider e nunca o XML — é essa fronteira que permitiu um segundo provedor
 * entrar sem mexer em nada acima.
 */
@Module({
  providers: [TravelfusionClient, TravelfusionCommands, TravelfusionProvider],
  exports: [TravelfusionCommands, TravelfusionProvider],
})
export class TravelfusionModule {}
