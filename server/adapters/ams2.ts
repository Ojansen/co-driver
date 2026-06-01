/**
 * Automobilista 2 adapter.
 *
 * AMS2 runs on the same Madness engine as Project CARS 2 and can emit the
 * identical "SMS UDP" packets — so it reuses the shared decoder (./sms-udp.ts)
 * on the same port (5606). In-game, set UDP Protocol Version to "Project CARS 2".
 *
 * This is its own decoder instance (independent state) under the `ams2` game id;
 * the multi-port listener collapses 5606 to a single socket, so PCARS2 and AMS2
 * share one listener and the in-app switcher just changes UI/labels.
 *
 * AMS2 also has a newer native UDP protocol with extra channels — if a needed
 * field is missing we can add an AMS2-native path later; PCARS2 mode covers the
 * canonical Telemetry model today.
 */

import { createSmsUdpAdapter } from './sms-udp'

export const ams2Adapter = createSmsUdpAdapter('ams2')
