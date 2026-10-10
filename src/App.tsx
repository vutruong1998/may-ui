import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Sts = lazy(() => import('./pages/Sts'))
const Buckets = lazy(() => import('./pages/s3/Buckets'))
const Bucket = lazy(() => import('./pages/s3/Bucket'))
const Roles = lazy(() => import('./pages/iam/Roles'))
const Role = lazy(() => import('./pages/iam/Role'))
const Users = lazy(() => import('./pages/iam/Users'))
const UserPage = lazy(() => import('./pages/iam/User'))
const Groups = lazy(() => import('./pages/iam/Groups'))
const Group = lazy(() => import('./pages/iam/Group'))
const Policies = lazy(() => import('./pages/iam/Policies'))
const Policy = lazy(() => import('./pages/iam/Policy'))
const InstanceProfiles = lazy(() => import('./pages/iam/InstanceProfiles'))
const Queues = lazy(() => import('./pages/sqs/Queues'))
const Queue = lazy(() => import('./pages/sqs/Queue'))
const Tables = lazy(() => import('./pages/dynamodb/Tables'))
const DynamoTable = lazy(() => import('./pages/dynamodb/Table'))
const LogGroups = lazy(() => import('./pages/cloudwatch/Groups'))
const LogGroup = lazy(() => import('./pages/cloudwatch/Group'))
const Instances = lazy(() => import('./pages/ec2/Instances'))
const InstancePage = lazy(() => import('./pages/ec2/Instance'))
const Network = lazy(() => import('./pages/ec2/Network'))
const SecurityGroups = lazy(() => import('./pages/ec2/SecurityGroups'))
const KeyPairs = lazy(() => import('./pages/ec2/KeyPairs'))
const Databases = lazy(() => import('./pages/rds/Databases'))
const DatabasePage = lazy(() => import('./pages/rds/Database'))
const SubnetGroups = lazy(() => import('./pages/rds/SubnetGroups'))
const ParameterGroups = lazy(() => import('./pages/rds/ParameterGroups'))
const DBSnapshots = lazy(() => import('./pages/rds/Snapshots'))
import { Empty, PageHeader } from '@/components/common'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="s3" element={<Buckets />} />
        <Route path="s3/:bucket" element={<Bucket />} />
        <Route path="sqs" element={<Queues />} />
        <Route path="sqs/:name" element={<Queue />} />
        <Route path="rds/databases" element={<Databases />} />
        <Route path="rds/databases/:id" element={<DatabasePage />} />
        <Route path="rds/subnet-groups" element={<SubnetGroups />} />
        <Route path="rds/parameter-groups" element={<ParameterGroups />} />
        <Route path="rds/snapshots" element={<DBSnapshots />} />
        <Route path="dynamodb" element={<Tables />} />
        <Route path="dynamodb/:name" element={<DynamoTable />} />
        <Route path="logs" element={<LogGroups />} />
        <Route path="logs/group" element={<LogGroup />} />
        <Route path="ec2/instances" element={<Instances />} />
        <Route path="ec2/instances/:id" element={<InstancePage />} />
        <Route path="ec2/network" element={<Network />} />
        <Route path="ec2/security-groups" element={<SecurityGroups />} />
        <Route path="ec2/key-pairs" element={<KeyPairs />} />
        <Route path="iam/roles" element={<Roles />} />
        <Route path="iam/roles/:name" element={<Role />} />
        <Route path="iam/users" element={<Users />} />
        <Route path="iam/users/:name" element={<UserPage />} />
        <Route path="iam/groups" element={<Groups />} />
        <Route path="iam/groups/:name" element={<Group />} />
        <Route path="iam/policies" element={<Policies />} />
        <Route path="iam/policies/view" element={<Policy />} />
        <Route path="iam/instance-profiles" element={<InstanceProfiles />} />
        <Route path="sts" element={<Sts />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<><PageHeader title="Not found" /><Empty title="This page does not exist" /></>} />
      </Route>
    </Routes>
  )
}
