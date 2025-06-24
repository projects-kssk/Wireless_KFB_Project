import { BranchDisplayData } from '@/types/branch';

export const MOCK_KSK_NUMBER = "80%";
export const MOCK_KFB_BOARD_NAME = "IW0160029";
export const initialMockBranchItems: Omit<BranchDisplayData, 'testStatus'>[] = [
  { id: 'branch-1', branchName: 'ALPHA LINE', okSubStatus1: { label: "Pressure", value: "Nominal", status: 'ok'}, okSubStatus2: { label: "Temp Ctrl", value: "Stable", status: 'ok'} },
  { id: 'branch-2', branchName: 'BRAVO LINE' },
  { id: 'branch-3', branchName: 'CHARLIE SYSTEM' },
  { id: 'branch-4', branchName: 'DELTA UNIT', okSubStatus1: { label: "Flow Rate", value: "Optimal", status: 'ok'}, okSubStatus2: { label: "Filtration", value: "Clean", status: 'ok'} },
  { id: 'branch-5', branchName: 'ECHO STATION' },
  { id: 'branch-6', branchName: 'FOXTROT CELL' },
  { id: 'branch-7', branchName: 'GOLF RIG', okSubStatus1: { label: "Vibration", value: "Low", status: 'ok'}, okSubStatus2: { label: "Alignment", value: "Warning", status: 'warning'} },
  { id: 'branch-8', branchName: 'HOTEL MODULE' },
  { id: 'branch-9', branchName: 'INDIA POINT', okSubStatus1: { label: "Sensor Cal", value: "Valid", status: 'ok'}, okSubStatus2: { label: "Battery", value: "75%", status: 'info'} },
  { id: 'branch-10', branchName: 'JULIET ARRAY' },
  { id: 'branch-11', branchName: 'KILO SETUP', okSubStatus1: { label: "Network", value: "Connected", status: 'ok'}, okSubStatus2: { label: "Power", value: "Grid", status: 'ok'} },
  { id: 'branch-12', branchName: 'LIMA STATION' },
  { id: 'branch-13', branchName: 'MIKE PLATFORM' },
  { id: 'branch-14', branchName: 'NOVEMBER UNIT', okSubStatus1: {label: "Test A", value: "Pass", status: 'ok'}, okSubStatus2: {label: "Test B", value: "Pass", status: 'ok'}},
];