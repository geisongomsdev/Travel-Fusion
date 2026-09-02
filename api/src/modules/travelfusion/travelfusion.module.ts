import { Module } from '@nestjs/common';
import { TravelfusionClient } from './travelfusion.client';
import { TravelfusionCommands } from './travelfusion.commands';

/**
 * Tudo que sabe o que é Travelfusion mora aqui. O módulo de voo consome os
 * comandos e nunca o XML — é essa fronteira que permite um segundo provedor
 * entrar sem mexer em nada acima.
 */
@Module({
  providers: [TravelfusionClient, TravelfusionCommands],
  exports: [TravelfusionCommands],
})
export class TravelfusionModule {}
