import { Module } from '@nestjs/common';
import { LatamModule } from './latam/latam.module';
import { TravelfusionModule } from './travelfusion/travelfusion.module';
import { ProviderRegistry } from './provider.registry';

/** O registry é o único ponto onde alguém escolhe provedor. */
@Module({
  imports: [TravelfusionModule, LatamModule],
  providers: [ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
