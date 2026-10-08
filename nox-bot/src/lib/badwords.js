'use strict';

/**
 * Words the chat filter blocks (src/features/chatfilter.js) – swearing and hateful slurs in many languages.
 *
 * Written lowercase, a–z only, no accents (the filter strips them and turns Cyrillic into Latin first).
 *   WORD    – the whole word only            ("shit", not "shitake")
 *   PREFIX  – the word starts with it        ("kurw" → kurwa, kurwy, kurwą)
 *   CONTAINS – anywhere in a word (long slurs only, they show up glued to other words)
 * SAFE words are never blocked even when they start with / contain an entry.
 * Add your own in config.json → chatFilter.extraWords ("word" or "stem*"), exceptions in chatFilter.allowedWords.
 * Left out on purpose (normal words somewhere): fan, con, pic, negro, anjing, babi, lund, cholera, damn, hell.
 */

const SLUR = {
  word: [
    'nigga', 'niggas', 'niggaz', 'niggah', 'nigguh', 'nibba', 'niga', 'chink', 'chinks', 'gook', 'gooks', 'spic', 'spics', 'spick',
    'kike', 'kikes', 'paki', 'pakis', 'coon', 'coons', 'wetback', 'beaner', 'beaners', 'raghead', 'towelhead', 'jigaboo',
    'zipperhead', 'golliwog', 'honky', 'tranny', 'trannies', 'fag', 'fags', 'dyke', 'dykes', 'retard', 'retards', 'retarded',
    'pedzio', 'pedziu', 'ciota', 'cioty', 'ciote', 'ciotom', 'kacap', 'kacapy', 'ukrop', 'ukropy',
    'szwab', 'szwaby', 'zydek', 'zydki', 'zydy', 'neger', 'negern', 'negrer', 'blatte', 'blattar', 'maricon', 'maricones', 'sudaca',
    'frocio', 'froci', 'viado', 'viados', 'buzi', 'buzik', 'peder', 'pederi', 'pidor', 'pidar', 'pidoras', 'pidaras', 'pedik',
    'cigan', 'cigani', 'zhid', 'zhidy', 'khokhol', 'hohol', 'chernomazy', 'kanake', 'kanaken', 'schwuchtel', 'bougnoule',
    'youpin', 'negre', 'negres', 'bamboula', 'mongoloid', 'spast', 'spasti',
  ],
  prefix: ['czarnuch', 'murzyn', 'faggot', 'nigger', 'niggar', 'negroid'],
  contains: ['nigger', 'faggot', 'niggers'],
};

const PROFANITY = {
  word: [
    // English
    'shit', 'shits', 'shitty', 'bullshit', 'shithead', 'ass', 'asshole', 'assholes', 'arse', 'arsehole', 'dick', 'dicks', 'dickhead',
    'cock', 'cocks', 'cocksucker', 'cunt', 'cunts', 'pussy', 'pussies', 'whore', 'whores', 'slut', 'sluts', 'bastard', 'bastards',
    'wanker', 'wankers', 'twat', 'twats', 'prick', 'pricks', 'cum', 'jizz', 'bollocks', 'motherfucker', 'motherfuckers', 'mf', 'stfu',     // Polish
    'dupa', 'dupy', 'dupek', 'dupku', 'ciul', 'cipa', 'cipy', 'cipe', 'chuj', 'chuja', 'chujowy', 'huj', 'huja', 'kutas',
    'kutasy', 'fiut', 'fiuta', 'dziwka', 'dziwki', 'szmata', 'szmaty', 'pizda', 'pizdy', 'cwel', 'cwele', 'kurwa',     'jebac', 'jebany', 'jebana', 'jebane', 'jebie', 'jebal', 'jebnij', 'chujnia', 'hujnia', 'ruchac', 'pierdol', 'pierdole',
    // Swedish / Norwegian / Danish
    'fitta', 'fittan', 'kuk', 'kuken', 'hora', 'horan', 'javla', 'javlar', 'faen', 'fitte', 'pikk', 'kuksugare', 'knulla', 'knull',
    // German / Dutch
    'fotze', 'wichser', 'hurensohn', 'arschloch', 'schlampe', 'ficken', 'kut', 'klootzak', 'godverdomme', 'kankerlijer', 'tering', 'hoer',
    // French
    'putain', 'salope', 'connard', 'connasse', 'encule', 'pute', 'merde', 'nique', 'niquer', 'fdp', 'ntm', 'batard', 'couille', 'couilles',
    // Spanish / Portuguese / Italian
    'puta', 'putas', 'puto', 'putos', 'pendejo', 'pendeja', 'cabron', 'cabrona', 'gilipollas', 'mierda', 'joder', 'verga', 'chingada',
    'chingar', 'culero', 'caralho', 'porra', 'foda', 'fodase', 'buceta', 'arrombado', 'cazzo', 'vaffanculo', 'stronzo', 'troia', 'puttana', 'minchia', 'coglione',
    // Turkish / Romanian / Czech / Hungarian / Balkan / Greek / Russian
    'amk', 'orospu', 'siktir', 'yarrak', 'muie', 'cacat', 'kokot', 'kurva', 'kurvo', 'fuk', 'fukk', 'suka', 'geci', 'fasz', 'kurac', 'picka', 'jebem', 'govno',
    'malakas', 'malaka', 'gamoto', 'blyat', 'blyad', 'bljat', 'cyka', 'pizdec', 'nahui', 'nahuy', 'huy', 'khuy', 'ebat', 'yebat', 'mudak',
    // Arabic / Hindi-Urdu / Indonesian / Tagalog / Finnish
    'sharmouta', 'sharmuta', 'kosomak', 'zebi', 'madarchod', 'behenchod', 'bhenchod', 'chutiya', 'chutia', 'bhosdike', 'gandu',
    'bangsat', 'kontol', 'memek', 'ngentot', 'putangina', 'tangina', 'gago', 'vittu', 'vitun', 'huora', 'kyrpa',
  ],
  prefix: [
    'fuck', 'fck', 'motherfuck', 'bitch', 'kurw', 'skurw', 'pierdol', 'pierdal', 'spierdal', 'wypierdal', 'zapierdal', 'odpierdal',
    'rozpierdal', 'najeb', 'zajeb', 'wyjeb', 'odjeb', 'pojeb', 'dojeb', 'ujeb', 'przejeb', 'jebac', 'jeban', 'jebn', 'pizd', 'chujow', 'zjeb',
    'scheiss', 'scheis', 'hurens', 'putain', 'enculer', 'gilipoll', 'chinga', 'vaffancul', 'orospu', 'siktir', 'pizdec',
    'madarchod', 'behenchod', 'bhenchod', 'cocksuck', 'dickhead', 'shithead', 'dumbass', 'jackass', 'smartass',
  ],
  contains: ['motherfuck'],
};

const SAFE = [
  'scunthorpe', 'penistone', 'cocktail', 'cockpit', 'cockroach', 'peacock', 'hancock', 'assassin', 'assess', 'assist', 'assign', 'asset',
  'classic', 'passport', 'massage', 'analysis', 'therapist', 'cumulative', 'cucumber', 'dickens', 'dickson', 'shitake', 'shiitake',
  'nigeria', 'niger', 'snigger', 'spice', 'specific', 'raccoon', 'cocoon', 'kurier', 'pedaling', 'pedalboard', 'huile',   'blatant', 'skurcz', 'kuchnia', 'arsenal', 'pussycat', 'mongolia', 'blattaria', 'fukushima', 'kurve', ];

module.exports = { SLUR, PROFANITY, SAFE };
