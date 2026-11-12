export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh'
]

export const STATE_CODE_MAP = {
  'Jammu and Kashmir': '01',
  'Himachal Pradesh': '02',
  'Punjab': '03',
  'Chandigarh': '04',
  'Uttarakhand': '05',
  'Haryana': '06',
  'Delhi': '07',
  'Rajasthan': '08',
  'Uttar Pradesh': '09',
  'Bihar': '10',
  'Sikkim': '11',
  'Arunachal Pradesh': '12',
  'Nagaland': '13',
  'Manipur': '14',
  'Mizoram': '15',
  'Tripura': '16',
  'Meghalaya': '17',
  'Assam': '18',
  'West Bengal': '19',
  'Jharkhand': '20',
  'Odisha': '21',
  'Chhattisgarh': '22',
  'Madhya Pradesh': '23',
  'Gujarat': '24',
  'Maharashtra': '27',
  'Karnataka': '29',
  'Goa': '30',
  'Kerala': '32',
  'Tamil Nadu': '33',
  'Puducherry': '34',
  'Telangana': '36',
  'Andhra Pradesh': '37',
  'Ladakh': '38',
}

export const CODE_TO_STATE_MAP = Object.fromEntries(
  Object.entries(STATE_CODE_MAP).map(([st, cd]) => [cd, st])
)

export const defaultCompanySettings = {
  company_name: 'Viora Bills',
  business_address: '101, Business Park, Pune, Maharashtra',
  gstin: '27AABCU9603R1ZM',
  phone: '+91 9876543210',
  email: 'contact@viorabills.com',
  state: 'Maharashtra',
  pincode: '411001',
  logo_url: '',
  bank_name: 'HDFC Bank',
  account_holder_name: 'Viora Bills Solutions Pvt Ltd',
  account_number: '50200012345678',
  ifsc_code: 'HDFC0001234',
  upi_id: 'viorabills@upi',
}

export const initialCustomer = {
  name: '',
  business_name: '',
  email: '',
  phone: '',
  address: '',
  state: '',
  state_code: '',
  pincode: '',
  gstin: '',
}

export const initialProduct = {
  name: '',
  price: '',
  unit: 'Piece',
  gst_rate: '18',
}

export const initialPayment = {
  invoice_id: '',
  amount: '',
  payment_method: 'UPI',
  reference: '',
  notes: '',
}

export function getFutureDate(days = 30) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export function getTodayDate() {
  return new Date().toISOString().split('T')[0]
}

