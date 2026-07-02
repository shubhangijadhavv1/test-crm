/**
 * One-off importer for the real Demo Projects list (idempotent — re-running updates).
 *   npx tsx src/seed/import-demo-projects.ts
 * Creates referenced employees, website types & servers, then upserts demo projects.
 */
import { connectDB, disconnectDB } from '../config/db'
import { User } from '../models/User'
import { WebsiteType, ServerModel } from '../models/catalog'
import { Project } from '../models/Project'
import { hashPassword } from '../utils/password'

// name, url, tech, server, assignee, priority, statusText, due
type Row = [string, string, string, string, string, string, string, string]

const STATUS: Record<string, string> = {
  'Finished': 'finished',
  'On Hold': 'onhold',
  'Not Started': 'pending',
  'Domain Transfer to Live Domain': 'domain_transfer',
}

const DATA: Row[] = [
  ['India Multiple Slots (HTML-Demo4)', '', 'HTML', 'Local', 'Prasad Sontakke', 'medium', 'Finished', '2026-05-28'],
  ['India Multiple Slots (HTML-Demo3)', '', 'HTML', 'Local', 'Prasad Sontakke', 'medium', 'Finished', '2026-05-28'],
  ['India Multiple Slots (HTML-Demo2)', '', 'HTML', 'Local', 'Prasad Sontakke', 'medium', 'Finished', '2026-05-26'],
  ['India Multiple Slots (HTML-Demo1)', '', 'HTML', 'Local', 'Prasad Sontakke', 'medium', 'Finished', '2026-05-25'],
  ['India Multiple Slots-1', 'https://wpsitecheck.xyz/demo/newslot33/', 'Wordpress + Elementor', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-03-06'],
  ['India multiple Slots-2', 'https://wpsitecheck.xyz/demo/indslot10', 'Wordpress + Elementor', 'Super Dedicated', '', 'medium', 'Finished', '2025-10-28'],
  ['Finland Multiple Slots-16', 'https://wpsitecheck.xyz/demo/finland68/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'On Hold', '2026-04-06'],
  ['Finland Multiple Slots-15', 'https://wpsitecheck.xyz/demo/finland67/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-01-19'],
  ['Finland Multiple Slots-14', 'https://wpsitecheck.xyz/demo/finslot1/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-08-26'],
  ['Finland Multiple Slots-13', 'https://wpsitecheck.xyz/demo/finland51/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'On Hold', '2026-04-06'],
  ['Finland Multiple Slots-12', 'https://wpsitecheck.xyz/demo/finland49/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-04-06'],
  ['Finland Multiple Slots-11', 'https://wpsitecheck.xyz/demo/finland46/', 'WordPress-(Uicore)', 'Super Dedicated', '', 'medium', 'Finished', '2025-12-23'],
  ['Finland Multiple Slots-10', 'https://wpsitecheck.xyz/demo/finland45/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'On Hold', '2025-12-19'],
  ['Finland Multiple Slots-9', 'https://wpsitecheck.xyz/demo/finland44/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-18'],
  ['Finland Multiple Slots-8', 'https://wpsitecheck.xyz/demo/finland42/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-17'],
  ['Finland Multiple Slots-7', 'https://wpsitecheck.xyz/demo/finland39/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-16'],
  ['Finland Multiple Slots-6', 'https://wpsitecheck.xyz/demo/finslot9/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'On Hold', '2026-04-06'],
  ['Finland Multiple Slots-4', 'https://wpsitecheck.xyz/demo/finslot7/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-09-02'],
  ['Finland Multiple Slots-5', 'https://wpsitecheck.xyz/demo/finslot8/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-09-03'],
  ['Finland Multiple Slots-3', 'https://wpsitecheck.xyz/demo/finslot6/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-09-01'],
  ['Finland Multiple Slots-2', 'https://wpsitecheck.xyz/demo/finslot5/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-08-29'],
  ['Finland Multiple Slots-1', 'https://wpsitecheck.xyz/demo/finslot4/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-08-28'],
  ['Chile Slot Demo 3', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-07-11'],
  ['Chile Slot Demo 2', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-07-10'],
  ['Chile Slot Demo 1', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-07-09'],
  ['Indian Multiple Slot demo 12', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-12'],
  ['Indian Multiple Slot demo 11', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-11'],
  ['Indian Multiple Slot demo 10', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-10'],
  ['Indian Multiple Slot demo 9', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-08'],
  ['Indian Multiple Slot demo 8', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-07'],
  ['Indian Multiple Slot demo 7', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-05'],
  ['Indian Multiple Slot demo 5', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-03'],
  ['Indian Multiple Slot demo 6', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-11-04'],
  ['Indian Multiple Slot demo 4', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-10-31'],
  ['Indian Multiple Slot demo 3', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-10-30'],
  ['Indian Multiple Slot demo 2', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-10-29'],
  ['Finland multiple slot demo 18', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-30'],
  ['Indian Multiple Slot demo 1', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-10-28'],
  ['Finland Multiple Slot demo 17', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-26'],
  ['Finland Multiple Slot demo 16', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-24'],
  ['Finland Multiple slot demo 15', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-23'],
  ['Finland Multiple Slot demo 12', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-17'],
  ['Finland Multiple Slot demo 14', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-22'],
  ['Finland multiple slot demo 13', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-18'],
  ['Finland Multiple slot demo 11', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-12-16'],
  ['Finland Multiple slot demo 10', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-20'],
  ['Finland multiple slot demo 8', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-18'],
  ['Finland multiple slot demo 9', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-19'],
  ['Finland Multiple slot demo 7', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-14'],
  ['Finland Multiple slot demo 6', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-13'],
  ['Finland multiple slot demo3', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-08'],
  ['Finland multiple slot demo5', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-12'],
  ['Finland multiple slot demo1', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-05'],
  ['Finland multiple slot demo4', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-11'],
  ['Finland multiple slot demo2', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-08-07'],
  ['Hotel demo 14 (C)', 'https://pacifico-imperial-hotel.ubpages.com/pacifico-imperial-hotel/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-20'],
  ['Hotel demo 13 (F)', 'https://lunorvik-grand-resort.ubpages.com/lunorvik-grand-resort/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-19'],
  ['Hotel demo 9 (F)', 'https://kaivola-prestige-manor.ubpages.com/kaivola-prestige-manor/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-18'],
  ['Hotel demo 10 (F)', 'https://saarivaara-aurora-estate.ubpages.com/saarivaara-aurora-estate/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-18'],
  ['Hotel demo 11 (F)', 'https://arkenfell-arctic-estate.ubpages.com/arkenfell-arctic-estate/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-18'],
  ['Hotel demo 12 (F)', 'https://borealis-crown-resort.ubpages.com/borealis-crown-resort/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-18'],
  ['Hotel demo 8 (F)', 'https://saarikallio-sovereign-estate.ubpages.com/saarikallio-sovereign-estate/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-07'],
  ['Hotel demo 7 (F)', 'https://eirael-nordic-chteau.ubpages.com/eirael-nordic-chteau/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-30'],
  ['Hotel demo 6 (F)', 'https://norynth-aurora.ubpages.com/norynth-aurora/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-29'],
  ['Hotel demo 5 (F)', 'https://lumoraresort.ubpages.com/lumora-resort/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-28'],
  ['Hotel demo 4 (F)', 'https://finalnd-vista-resort.ubpages.com/finalnd-vista-resort/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-27'],
  ['Hotel demo 3 (F)', 'https://orvexa-prestige.ubpages.com/orvexa-prestige/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-20'],
  ['Hotel demo 2 (F)', 'https://lumi-haven-resort.ubpages.com/lumi-haven-resort/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-16'],
  ['Hotel demo 1 (F)', 'https://saaristo-prive.ubpages.com/saaristo-prive/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-15'],
  ['Hotel Demo 12 (C)', 'https://luxevarra-palacio.ubpages.com/luxevarra-palacio/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-18'],
  ['Hotel Demo 13 (C)', 'https://sierra-dorada-palace.ubpages.com/sierra-dorada-palace/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-18'],
  ['Hotel demo 11 (C)', 'https://marvia-pacific-retreat.ubpages.com/marvia-pacific-retreat/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-08'],
  ['Hotel demo 10 (C)', 'https://eryndel-grand.ubpages.com/eryndel-grand/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-05-07'],
  ['Hotel demo 9 (C)', 'https://valenor-vinea-estate.ubpages.com/valenor-vinea-estate/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-30'],
  ['Hotel demo 8 (C)', 'https://cyrenthia-metropolitan-hotel.ubpages.com/cyrenthia-metropolitan-hotel/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-29'],
  ['Hotel demo 7 (C)', 'https://luzara-mountain-estate.ubpages.com/luzara-mountain-estate/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-28'],
  ['Hotel demo 6 (C)', 'https://aurevian-resort.ubpages.com/aurevian-resort/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-21'],
  ['Hotel demo 5 (C)', 'https://solmira-luxury-stay.ubpages.com/solmira-luxury-stay/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-17'],
  ['Hotel demo 4 (C)', 'https://elixir-valle.ubpages.com/elixir-valle/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-14'],
  ['Hotel demo 3 (C)', 'https://aureliogrand.ubpages.com/aureliogrand/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-11'],
  ['Hotel demo 2 (C)', 'https://the-velarion-reserve.ubpages.com/the-velarion-reserve/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-11'],
  ['Hotel demo 1 (C)', 'https://estanciadelviento.ubpages.com/estancia-del-viento/', 'Unbounce', 'Unbounce', 'Prasad Sontakke', 'high', 'Finished', '2026-04-11'],
  ['Unbouncepages.com/arctic-treehouse-hotel/', 'http://unbouncepages.com/arctic-treehouse-hotel/', 'Unbounce', 'Unbounce', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-25'],
  ['Unbouncepages.com/elarion-luxe/', 'http://unbouncepages.com/elarion-luxe/', 'Unbounce', 'Unbounce', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-29'],
  ['Unbouncepages.com/lemuria-hotel/', 'http://unbouncepages.com/lemuria-hotel/', 'Unbounce', 'Unbounce', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-28'],
  ['Unbouncepages.com/marriott-hotel/', 'http://unbouncepages.com/marriott-hotel/', 'Unbounce', 'Unbounce', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-25'],
  ['Unbouncepages.com/lapland-hotel/', 'http://unbouncepages.com/lapland-hotel/', 'Unbounce', 'Unbounce', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-26'],
  ['Unbouncepages.com/novaluxe-haven/', 'http://unbouncepages.com/novaluxe-haven/', 'Unbounce', 'Unbounce', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-29'],
  ['Chile 5-cat-2', 'https://wpsitecheck.xyz/demo/chile21/', 'Wordpress + Elementor', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-04-09'],
  ['Chile 5 Cat-1', 'https://wpsitecheck.xyz/demo/chile23/', 'Wordpress + Elementor', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-04-04'],
  ['Dating Sites Review Demo-2', '', 'Wordpress + Elementor', 'Wp Studio', 'Prasad Sontakke', 'high', 'Finished', '2026-04-24'],
  ['Dating Sites Review Demo-3', '', 'Wordpress + Elementor', 'Wp Studio', 'Prasad Sontakke', 'high', 'Finished', '2026-04-24'],
  ['Dating Sites Review Demo-1', '', 'Wordpress + Elementor', 'Wp Studio', 'Prasad Sontakke', 'high', 'Finished', '2026-04-24'],
  ['Chile Single Hotel Demo 10', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-13'],
  ['Chile Single Hotel Demo 9', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-10'],
  ['Chile Single Hotel Demo 8', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-09'],
  ['Chile Hotel-10', '', 'Wordpress Classic', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Not Started', '2026-04-11'],
  ['Chile Hotel-9', '', 'Wordpress Classic', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Finished', '2026-04-08'],
  ['Chile Hotel-7', '', 'Wordpress Classic', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Finished', '2026-04-06'],
  ['Aus Lottery demo1', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-06-10'],
  ['Chile Single Hotel Demo 7', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-08'],
  ['Casino review-3', 'https://wpsitecheck.xyz/demo/argcasino11/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-13'],
  ['Casino review-4', 'https://wpsitecheck.xyz/demo/argcasino13/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-13'],
  ['Casino review-5', 'https://wpsitecheck.xyz/demo/argcasino14/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-14'],
  ['Casino review-6', 'https://wpsitecheck.xyz/demo/argcasino15/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-14'],
  ['Casino review-2', 'https://wpsitecheck.xyz/demo/argcasino10/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-13'],
  ['Casino review-1', 'https://wpsitecheck.xyz/demo/argcasino9/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-11'],
  ['Casino review-8', 'https://wpsitecheck.xyz/demo/argcasino18/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-16'],
  ['Casino review-7', 'https://wpsitecheck.xyz/demo/argcasino16/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-15'],
  ['Casino review-15', 'https://wpsitecheck.xyz/demo/argcasino25/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-13'],
  ['Casino review-14', 'https://wpsitecheck.xyz/demo/argcasino24/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-12'],
  ['Casino review-13', 'https://wpsitecheck.xyz/demo/argcasino23/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-11'],
  ['Casino review-12', 'https://wpsitecheck.xyz/demo/argcasino22/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-10'],
  ['Casino review-11', 'https://wpsitecheck.xyz/demo/argcasino21/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-09'],
  ['Casino review-10', 'https://wpsitecheck.xyz/demo/argcasino20/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-08'],
  ['Casino review-9', 'https://wpsitecheck.xyz/demo/argcasino19/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-12-04'],
  ['Aus Lottery-10', 'https://wpsitecheck.xyz/demo/auslot19/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'On Hold', '2026-04-06'],
  ['Aus Lottery-9', 'https://wpsitecheck.xyz/demo/auslot18/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-09'],
  ['Aus Lottery-8', 'https://wpsitecheck.xyz/demo/auslot17/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-08'],
  ['Aus Lotter-6', 'https://wpsitecheck.xyz/demo/auslot15/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-06'],
  ['Aus Lottery-7', 'https://wpsitecheck.xyz/demo/auslot16/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-07'],
  ['Aus Lottery-5', 'https://wpsitecheck.xyz/demo/auslot13/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-05-29'],
  ['Aus Lottery-4', 'https://wpsitecheck.xyz/demo/auslot12/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-05-29'],
  ['Aus Lottery-3', 'https://wpsitecheck.xyz/demo/auslot11/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2025-05-28'],
  ['Aus Lottery-2', 'https://wpsitecheck.xyz/demo/auslot9/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2025-05-24'],
  ['Aus Lottery-1', 'https://wpsitecheck.xyz/demo/auslot10/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2025-05-26'],
  ['Argentina Hotel-4', 'https://wpsitecheck.xyz/demo/Arganohotel1/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-11'],
  ['Argentina Hotel-3', 'https://wpsitecheck.xyz/demo/Arganohotel/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-10'],
  ['Argentina Hotel-2', 'https://wpsitecheck.xyz/demo/Arganohotel3/', 'WordPress-(Uicore)', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-04-06'],
  ['Argentina Hotel-1', 'https://wpsitecheck.xyz/demo/Arganohotel2/', 'WordPress-(Uicore)', '', 'Prasad Sontakke', 'medium', 'Finished', '2025-10-24'],
  ['Finland Hotel-5', 'https://wpsitecheck.xyz/demo/finhotel8', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-28'],
  ['Finland Hotel-4', 'https://wpsitecheck.xyz/demo/finhotel5', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-26'],
  ['Finland Hotel-3', 'https://wpsitecheck.xyz/demo/finhotel3', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-24'],
  ['Finland Hotel-2', 'https://wpsitecheck.xyz/demo/finhotel1/', 'Wordpress + Elementor', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-23'],
  ['Finland Hotel-1', 'https://wpsitecheck.xyz/demo/finhotel/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-19'],
  ['Chile Travel Guide-7', 'https://chiletravel7.wordpress', 'Wordpress + Elementor', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2026-03-25'],
  ['Chile Travel Guide-6', 'https://chiletravel6.wordpress', 'Wordpress + Elementor', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2026-03-23'],
  ['Chile Travel Guide-1', 'https://chiletravel1.wordpress', 'Wordpress Classic', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2026-03-05'],
  ['Chile Travel Guide-2', 'https://chiletravel2.wordpress', 'Wordpress Classic', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2026-03-10'],
  ['Chile Travel Guide-3', 'https://chiletravel3.wordpress', 'Wordpress Classic', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2026-03-12'],
  ['Chile hotel-8', 'https://wpsitecheck.xyz/demo/chilehotel8/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Domain Transfer to Live Domain', '2026-02-17'],
  ['Chile Single Hotel Demo 5', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-03'],
  ['Chile Single Hotel Demo 6', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-06'],
  ['Chile Hotel-6', '', 'Wordpress Classic', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Finished', '2026-04-03'],
  ['Chile Hotel-5', 'https://wpsitecheck.xyz/demo/chilehotel5/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-16'],
  ['Chile Hotel-3', 'https://wpsitecheck.xyz/demo/chilehotel3/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-13'],
  ['Chile Hotel-2', 'https://wpsitecheck.xyz/demo/chilehotel2/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-12'],
  ['Chile hotel-1', 'https://wpsitecheck.xyz/demo/chilehotel1/', 'Wordpress Classic', 'Super Dedicated', 'Prasad Sontakke', 'medium', 'Finished', '2026-02-10'],
  ['Chile Single Hotel Demo 4', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-04-02'],
  ['Finland Lottery demo 5', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-04-22'],
  ['Finland Lottery demo 4', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-04-21'],
  ['Finland Lottery demo 3', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-04-18'],
  ['Finland Lottery demo 2', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-04-17'],
  ['Finland Lottery demo 1', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-04-16'],
  ['Aus Lottery demo 4', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-10-09'],
  ['Aus Lottery demo3', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-10-08'],
  ['Aus Lottery demo2', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-10-07'],
  ['Casino Hotel Argentina demo2', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-07-17'],
  ['Casino Hotel Argentina demo1', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-07-16'],
  ['Finland Single Hotel-review-demo 2', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-06-26'],
  ['Finland Single Hotel-review-demo1', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-06-19'],
  ['Finland Hotel demo 5', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-24'],
  ['Finland Hotel demo 4', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-23'],
  ['Finland Hotel demo 3', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-20'],
  ['Finland Hotel demo 2', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-19'],
  ['Finland Hotel demo1', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-18'],
  ['Chile Hotel Demo 3', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-16'],
  ['Chile Hotel Demo 2', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-14'],
  ['Chile Hotel Demo 1', '', 'React js', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-13'],
  ['Finland Single Hotel-review-demo 3', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2026-02-23'],
  ['Finland Single Hotel-review-demo 4', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-06-24'],
  ['Finland Single Hotel-review-demo 5', '', 'HTML', 'Local', 'Shubhangi Jadhav', 'medium', 'Finished', '2025-06-26'],
  ['Chile Travel Guide-5', 'https://chiletravel5.wordpress', 'Wordpress + Elementor', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Finished', '2026-03-17'],
  ['Chile Travel Guide-4', 'https://chiletravel4.wordpress', 'Wordpress + Elementor', 'Wp Studio', 'Prasad Sontakke', 'medium', 'Finished', '2026-03-14'],
]

async function main() {
  await connectDB()
  const sa = await User.findOne({ role: 'superadmin' }).lean()
  const by = sa?._id

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const empCache = new Map<string, unknown>()
  let empSeq = await User.countDocuments({ role: 'employee' })
  for (const name of [...new Set(DATA.map(r => r[4]))].filter(Boolean)) {
    let u: any = await User.findOne({ fullName: name, isDeleted: false })
    if (!u) {
      const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@gdc.com'
      empSeq++
      u = await User.create({ fullName: name, email, employeeId: `EMP-${String(empSeq).padStart(4, '0')}`, passwordHash: await hashPassword('Welcome@123'), role: 'employee', department: 'Development', designation: 'Web Developer', createdBy: by })
    }
    empCache.set(name, u._id)
  }
  const wtCache = new Map<string, unknown>()
  for (const name of [...new Set(DATA.map(r => r[2]))].filter(Boolean)) {
    let w: any = await WebsiteType.findOne({ name, isDeleted: false })
    if (!w) w = await WebsiteType.create({ name, createdBy: by })
    wtCache.set(name, w._id)
  }
  const srvCache = new Map<string, unknown>()
  for (const name of [...new Set(DATA.map(r => r[3]))].filter(Boolean)) {
    let s: any = await ServerModel.findOne({ name, isDeleted: false })
    if (!s) s = await ServerModel.create({ name, createdBy: by })
    srvCache.set(name, s._id)
  }

  let created = 0, updated = 0
  let seq = await Project.countDocuments({ type: 'demo' })
  for (const [name, url, tech, server, assignee, priority, statusText, due] of DATA) {
    const status = STATUS[statusText] || 'pending'
    const fields = {
      type: 'demo', name, url: url || undefined,
      websiteTypeId: wtCache.get(tech), serverId: server ? srvCache.get(server) : undefined,
      ownerId: assignee ? empCache.get(assignee) : undefined, priority, status,
      qaProgress: 0, dueDate: new Date(due),
      createdBy: by, updatedBy: by,
    }
    const proj = await Project.findOne({ name, type: 'demo', isDeleted: false })
    if (proj) { Object.assign(proj, fields); await proj.save(); updated++ }
    else { seq++; await Project.create({ ...fields, projectCode: `DEM-${String(seq).padStart(4, '0')}` }); created++ }
  }

  await disconnectDB()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
