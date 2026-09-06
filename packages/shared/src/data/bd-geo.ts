/**
 * Bangladesh administrative divisions → districts → upazilas/thanas.
 *
 * Checkout addresses are Bangladesh-only, and a free-text district is how you
 * end up with "Cumilla", "Comilla" and "কুমিল্লা" in three rows of the same
 * order book. The dependent dropdowns in the checkout are driven from here, and
 * the server validates the submitted triple against the same table — so an
 * address that reaches the merchant's dashboard is always one a courier can act
 * on.
 *
 * Shared rather than client-side so both ends validate against one list.
 */

export type BdDistrict = {
    name: string;
    upazilas: readonly string[];
};

export type BdDivision = {
    name: string;
    districts: readonly BdDistrict[];
};

export const BD_DIVISIONS: readonly BdDivision[] = [
    {
        name: "Barishal",
        districts: [
            { name: "Barguna", upazilas: ["Amtali", "Bamna", "Barguna Sadar", "Betagi", "Patharghata", "Taltali"] },
            { name: "Barishal", upazilas: ["Agailjhara", "Babuganj", "Bakerganj", "Banaripara", "Barishal Sadar", "Gaurnadi", "Hizla", "Mehendiganj", "Muladi", "Wazirpur"] },
            { name: "Bhola", upazilas: ["Bhola Sadar", "Burhanuddin", "Char Fasson", "Daulatkhan", "Lalmohan", "Manpura", "Tazumuddin"] },
            { name: "Jhalokati", upazilas: ["Jhalokati Sadar", "Kathalia", "Nalchity", "Rajapur"] },
            { name: "Patuakhali", upazilas: ["Bauphal", "Dashmina", "Dumki", "Galachipa", "Kalapara", "Mirzaganj", "Patuakhali Sadar", "Rangabali"] },
            { name: "Pirojpur", upazilas: ["Bhandaria", "Kawkhali", "Mathbaria", "Nazirpur", "Nesarabad", "Pirojpur Sadar", "Indurkani"] },
        ],
    },
    {
        name: "Chattogram",
        districts: [
            { name: "Bandarban", upazilas: ["Alikadam", "Bandarban Sadar", "Lama", "Naikhongchhari", "Rowangchhari", "Ruma", "Thanchi"] },
            { name: "Brahmanbaria", upazilas: ["Akhaura", "Ashuganj", "Bancharampur", "Bijoynagar", "Brahmanbaria Sadar", "Kasba", "Nabinagar", "Nasirnagar", "Sarail"] },
            { name: "Chandpur", upazilas: ["Chandpur Sadar", "Faridganj", "Haimchar", "Haziganj", "Kachua", "Matlab Dakshin", "Matlab Uttar", "Shahrasti"] },
            { name: "Chattogram", upazilas: ["Anwara", "Banshkhali", "Boalkhali", "Chandanaish", "Chattogram City", "Fatikchhari", "Hathazari", "Karnaphuli", "Lohagara", "Mirsharai", "Patiya", "Rangunia", "Raozan", "Sandwip", "Satkania", "Sitakunda"] },
            { name: "Cox's Bazar", upazilas: ["Chakaria", "Cox's Bazar Sadar", "Kutubdia", "Maheshkhali", "Pekua", "Ramu", "Teknaf", "Ukhia"] },
            { name: "Cumilla", upazilas: ["Barura", "Brahmanpara", "Burichang", "Chandina", "Chauddagram", "Cumilla Adarsha Sadar", "Cumilla Sadar Dakshin", "Daudkandi", "Debidwar", "Homna", "Laksam", "Meghna", "Monohorganj", "Muradnagar", "Nangalkot", "Titas"] },
            { name: "Feni", upazilas: ["Chhagalnaiya", "Daganbhuiyan", "Feni Sadar", "Fulgazi", "Parshuram", "Sonagazi"] },
            { name: "Khagrachhari", upazilas: ["Dighinala", "Khagrachhari Sadar", "Lakshmichhari", "Mahalchhari", "Manikchhari", "Matiranga", "Panchhari", "Ramgarh"] },
            { name: "Lakshmipur", upazilas: ["Kamalnagar", "Lakshmipur Sadar", "Raipur", "Ramganj", "Ramgati"] },
            { name: "Noakhali", upazilas: ["Begumganj", "Chatkhil", "Companiganj", "Hatiya", "Kabirhat", "Noakhali Sadar", "Senbagh", "Sonaimuri", "Subarnachar"] },
            { name: "Rangamati", upazilas: ["Bagaichhari", "Barkal", "Belaichhari", "Juraichhari", "Kaptai", "Kawkhali", "Langadu", "Naniarchar", "Rajasthali", "Rangamati Sadar"] },
        ],
    },
    {
        name: "Dhaka",
        districts: [
            { name: "Dhaka", upazilas: ["Dhaka North City", "Dhaka South City", "Dhamrai", "Dohar", "Keraniganj", "Nawabganj", "Savar"] },
            { name: "Faridpur", upazilas: ["Alfadanga", "Bhanga", "Boalmari", "Charbhadrasan", "Faridpur Sadar", "Madhukhali", "Nagarkanda", "Sadarpur", "Saltha"] },
            { name: "Gazipur", upazilas: ["Gazipur Sadar", "Kaliakair", "Kaliganj", "Kapasia", "Sreepur"] },
            { name: "Gopalganj", upazilas: ["Gopalganj Sadar", "Kashiani", "Kotalipara", "Muksudpur", "Tungipara"] },
            { name: "Kishoreganj", upazilas: ["Austagram", "Bajitpur", "Bhairab", "Hossainpur", "Itna", "Karimganj", "Katiadi", "Kishoreganj Sadar", "Kuliarchar", "Mithamain", "Nikli", "Pakundia", "Tarail"] },
            { name: "Madaripur", upazilas: ["Dasar", "Kalkini", "Madaripur Sadar", "Rajoir", "Shibchar"] },
            { name: "Manikganj", upazilas: ["Daulatpur", "Ghior", "Harirampur", "Manikganj Sadar", "Saturia", "Shibalaya", "Singair"] },
            { name: "Munshiganj", upazilas: ["Gazaria", "Lohajang", "Munshiganj Sadar", "Sirajdikhan", "Sreenagar", "Tongibari"] },
            { name: "Narayanganj", upazilas: ["Araihazar", "Bandar", "Narayanganj Sadar", "Rupganj", "Sonargaon"] },
            { name: "Narsingdi", upazilas: ["Belabo", "Monohardi", "Narsingdi Sadar", "Palash", "Raipura", "Shibpur"] },
            { name: "Rajbari", upazilas: ["Baliakandi", "Goalandaghat", "Kalukhali", "Pangsha", "Rajbari Sadar"] },
            { name: "Shariatpur", upazilas: ["Bhedarganj", "Damudya", "Gosairhat", "Naria", "Shariatpur Sadar", "Zajira"] },
            { name: "Tangail", upazilas: ["Basail", "Bhuapur", "Delduar", "Dhanbari", "Ghatail", "Gopalpur", "Kalihati", "Madhupur", "Mirzapur", "Nagarpur", "Sakhipur", "Tangail Sadar"] },
        ],
    },
    {
        name: "Khulna",
        districts: [
            { name: "Bagerhat", upazilas: ["Bagerhat Sadar", "Chitalmari", "Fakirhat", "Kachua", "Mollahat", "Mongla", "Morrelganj", "Rampal", "Sarankhola"] },
            { name: "Chuadanga", upazilas: ["Alamdanga", "Chuadanga Sadar", "Damurhuda", "Jibannagar"] },
            { name: "Jashore", upazilas: ["Abhaynagar", "Bagherpara", "Chaugachha", "Jashore Sadar", "Jhikargachha", "Keshabpur", "Manirampur", "Sharsha"] },
            { name: "Jhenaidah", upazilas: ["Harinakunda", "Jhenaidah Sadar", "Kaliganj", "Kotchandpur", "Maheshpur", "Shailkupa"] },
            { name: "Khulna", upazilas: ["Batiaghata", "Dacope", "Dighalia", "Dumuria", "Khulna City", "Koyra", "Paikgachha", "Phultala", "Rupsha", "Terokhada"] },
            { name: "Kushtia", upazilas: ["Bheramara", "Daulatpur", "Khoksa", "Kumarkhali", "Kushtia Sadar", "Mirpur"] },
            { name: "Magura", upazilas: ["Magura Sadar", "Mohammadpur", "Shalikha", "Sreepur"] },
            { name: "Meherpur", upazilas: ["Gangni", "Meherpur Sadar", "Mujibnagar"] },
            { name: "Narail", upazilas: ["Kalia", "Lohagara", "Narail Sadar"] },
            { name: "Satkhira", upazilas: ["Assasuni", "Debhata", "Kalaroa", "Kaliganj", "Satkhira Sadar", "Shyamnagar", "Tala"] },
        ],
    },
    {
        name: "Mymensingh",
        districts: [
            { name: "Jamalpur", upazilas: ["Baksiganj", "Dewanganj", "Islampur", "Jamalpur Sadar", "Madarganj", "Melandaha", "Sarishabari"] },
            { name: "Mymensingh", upazilas: ["Bhaluka", "Dhobaura", "Fulbaria", "Gaffargaon", "Gauripur", "Haluaghat", "Ishwarganj", "Muktagachha", "Mymensingh Sadar", "Nandail", "Phulpur", "Tarakanda", "Trishal"] },
            { name: "Netrokona", upazilas: ["Atpara", "Barhatta", "Durgapur", "Kalmakanda", "Kendua", "Khaliajuri", "Madan", "Mohanganj", "Netrokona Sadar", "Purbadhala"] },
            { name: "Sherpur", upazilas: ["Jhenaigati", "Nakla", "Nalitabari", "Sherpur Sadar", "Sreebardi"] },
        ],
    },
    {
        name: "Rajshahi",
        districts: [
            { name: "Bogura", upazilas: ["Adamdighi", "Bogura Sadar", "Dhunat", "Dhupchanchia", "Gabtali", "Kahaloo", "Nandigram", "Sariakandi", "Shajahanpur", "Sherpur", "Shibganj", "Sonatala"] },
            { name: "Chapainawabganj", upazilas: ["Bholahat", "Chapainawabganj Sadar", "Gomastapur", "Nachole", "Shibganj"] },
            { name: "Joypurhat", upazilas: ["Akkelpur", "Joypurhat Sadar", "Kalai", "Khetlal", "Panchbibi"] },
            { name: "Naogaon", upazilas: ["Atrai", "Badalgachhi", "Dhamoirhat", "Manda", "Mohadevpur", "Naogaon Sadar", "Niamatpur", "Patnitala", "Porsha", "Raninagar", "Sapahar"] },
            { name: "Natore", upazilas: ["Bagatipara", "Baraigram", "Gurudaspur", "Lalpur", "Naldanga", "Natore Sadar", "Singra"] },
            { name: "Pabna", upazilas: ["Atgharia", "Bera", "Bhangura", "Chatmohar", "Faridpur", "Ishwardi", "Pabna Sadar", "Santhia", "Sujanagar"] },
            { name: "Rajshahi", upazilas: ["Bagha", "Bagmara", "Charghat", "Durgapur", "Godagari", "Mohanpur", "Paba", "Puthia", "Rajshahi City", "Tanore"] },
            { name: "Sirajganj", upazilas: ["Belkuchi", "Chauhali", "Kamarkhanda", "Kazipur", "Raiganj", "Shahjadpur", "Sirajganj Sadar", "Tarash", "Ullahpara"] },
        ],
    },
    {
        name: "Rangpur",
        districts: [
            { name: "Dinajpur", upazilas: ["Birampur", "Birganj", "Biral", "Bochaganj", "Chirirbandar", "Dinajpur Sadar", "Ghoraghat", "Hakimpur", "Kaharole", "Khansama", "Nawabganj", "Parbatipur", "Phulbari"] },
            { name: "Gaibandha", upazilas: ["Gaibandha Sadar", "Gobindaganj", "Palashbari", "Phulchhari", "Sadullapur", "Saghata", "Sundarganj"] },
            { name: "Kurigram", upazilas: ["Bhurungamari", "Char Rajibpur", "Chilmari", "Kurigram Sadar", "Nageshwari", "Phulbari", "Rajarhat", "Raomari", "Ulipur"] },
            { name: "Lalmonirhat", upazilas: ["Aditmari", "Hatibandha", "Kaliganj", "Lalmonirhat Sadar", "Patgram"] },
            { name: "Nilphamari", upazilas: ["Dimla", "Domar", "Jaldhaka", "Kishoreganj", "Nilphamari Sadar", "Saidpur"] },
            { name: "Panchagarh", upazilas: ["Atwari", "Boda", "Debiganj", "Panchagarh Sadar", "Tetulia"] },
            { name: "Rangpur", upazilas: ["Badarganj", "Gangachhara", "Kaunia", "Mithapukur", "Pirgachha", "Pirganj", "Rangpur Sadar", "Taraganj"] },
            { name: "Thakurgaon", upazilas: ["Baliadangi", "Haripur", "Pirganj", "Ranisankail", "Thakurgaon Sadar"] },
        ],
    },
    {
        name: "Sylhet",
        districts: [
            { name: "Habiganj", upazilas: ["Ajmiriganj", "Bahubal", "Baniyachong", "Chunarughat", "Habiganj Sadar", "Lakhai", "Madhabpur", "Nabiganj", "Shayestaganj"] },
            { name: "Moulvibazar", upazilas: ["Barlekha", "Juri", "Kamalganj", "Kulaura", "Moulvibazar Sadar", "Rajnagar", "Sreemangal"] },
            { name: "Sunamganj", upazilas: ["Bishwambharpur", "Chhatak", "Derai", "Dharampasha", "Dowarabazar", "Jagannathpur", "Jamalganj", "Madhyanagar", "Shantiganj", "Sullah", "Sunamganj Sadar", "Tahirpur"] },
            { name: "Sylhet", upazilas: ["Balaganj", "Beanibazar", "Bishwanath", "Companiganj", "Dakshin Surma", "Fenchuganj", "Golapganj", "Gowainghat", "Jaintiapur", "Kanaighat", "Osmani Nagar", "Sylhet Sadar", "Zakiganj"] },
        ],
    },
] as const;

export const BD_DIVISION_NAMES: readonly string[] = BD_DIVISIONS.map((d) => d.name);

export function districtsOf(division: string): readonly BdDistrict[] {
    return BD_DIVISIONS.find((d) => d.name === division)?.districts ?? [];
}

export function upazilasOf(division: string, district: string): readonly string[] {
    return districtsOf(division).find((d) => d.name === district)?.upazilas ?? [];
}

/**
 * True only when the three parts form a real division → district → upazila
 * chain. The server calls this on every order so a hand-crafted request cannot
 * store an address the merchant can't ship to.
 */
export function isValidBdAddress(
    division: string,
    district: string,
    upazila: string,
): boolean {
    return upazilasOf(division, district).includes(upazila);
}
