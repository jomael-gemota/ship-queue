import { Request, Response } from 'express';
import Shipment from '../models/Shipment';

export const getShipments = async (_req: Request, res: Response): Promise<void> => {
  try {
    const shipments = await Shipment.find().sort({ createdAt: -1 });
    res.json({ data: shipments });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch shipments', error });
  }
};

export const getShipmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) {
      res.status(404).json({ message: 'Shipment not found' });
      return;
    }
    res.json({ data: shipment });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch shipment', error });
  }
};

export const createShipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const shipment = await Shipment.create(req.body);
    res.status(201).json({ data: shipment });
  } catch (error) {
    res.status(400).json({ message: 'Failed to create shipment', error });
  }
};

export const updateShipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const shipment = await Shipment.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!shipment) {
      res.status(404).json({ message: 'Shipment not found' });
      return;
    }
    res.json({ data: shipment });
  } catch (error) {
    res.status(400).json({ message: 'Failed to update shipment', error });
  }
};

export const deleteShipment = async (req: Request, res: Response): Promise<void> => {
  try {
    const shipment = await Shipment.findByIdAndDelete(req.params.id);
    if (!shipment) {
      res.status(404).json({ message: 'Shipment not found' });
      return;
    }
    res.json({ message: 'Shipment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete shipment', error });
  }
};
